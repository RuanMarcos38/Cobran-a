import tempfile
import unittest
import threading
import urllib.request
import urllib.parse
from pathlib import Path
import app


class Flow(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        app.DB = Path(self.tmp.name) / 'test.sqlite3'
        app.init()
        self.title = app.validate_title(dict(nome='Ana <Teste>', email='ana@example.com', credor='Credora Exemplo', cobradora='Assessoria Exemplo', referencia='T-1', bordero='B-1', vencimento='2026-01-01', valor='100,50'))
        with app.connect() as db:
            db.execute('INSERT INTO titles (' + ','.join(self.title) + ') VALUES (' + ','.join('?' for _ in self.title) + ')', tuple(self.title.values()))
            self.row = db.execute('SELECT * FROM titles').fetchone()

    def tearDown(self):
        self.tmp.cleanup()

    def preview(self):
        subject, body = app.render(self.row, 'primeiro_contato')
        with app.connect() as db:
            db.execute('INSERT INTO sends (id,title_id,template,recipient,subject,body,snapshot,approval,operator,created) VALUES (?,?,?,?,?,?,?,?,?,?)', ('request1',1,'primeiro_contato',self.row['email'],subject,body,app.snapshot(self.row),'','Operador','2026-10-19'))
        return subject, body

    def test_send_and_duplicate(self):
        subject, body = self.preview()
        calls = []
        app.send_once('request1', lambda *args: calls.append(args))
        self.assertEqual(len(calls), 1)
        self.assertIn('Credora Exemplo', body)
        self.assertIn('R$ 100,50', body)
        with self.assertRaises(ValueError):
            app.send_once('request1', lambda *args: calls.append(args))
        with app.connect() as db:
            self.assertEqual(db.execute('SELECT status FROM sends').fetchone()[0], 'aceito_smtp')

    def test_status_changed_after_preview(self):
        self.preview()
        with app.connect() as db:
            db.execute("UPDATE titles SET status='quitado'")
        with self.assertRaises(ValueError):
            app.send_once('request1', lambda *args: self.fail('Não deve enviar'))

    def test_legal_requires_approval(self):
        with self.assertRaises(ValueError):
            app.render(self.row, 'ajuizamento_aprovado', '2099-01-01')
        subject, body = app.render(self.row, 'ajuizamento_aprovado', '2099-01-01', 'Dra. Exemplo, parecer interno 123', 'Operador')
        self.assertIn('aprovado o ajuizamento', body)

    def test_failed_smtp_is_not_retried(self):
        self.preview()
        def fail(*args):
            raise TimeoutError()
        with self.assertRaises(ValueError):
            app.send_once('request1', fail)
        with app.connect() as db:
            self.assertEqual(db.execute('SELECT status FROM sends').fetchone()[0], 'incerto')
        with self.assertRaises(ValueError):
            app.send_once('request1', lambda *args: self.fail('Não repetir'))

    def test_invalid_input(self):
        for bad in ['NaN', '-1', 'Infinity', '0']:
            with self.assertRaises(ValueError):
                app.validate_title({**self.title, 'valor':bad})
        with self.assertRaises(ValueError):
            app.validate_title({**self.title, 'email':'a@example.com,b@example.com'})

    def test_http_preview_and_csrf(self):
        server = app.HTTPServer(('127.0.0.1', 0), app.Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        base = 'http://127.0.0.1:' + str(server.server_port) + '/' + app.TOKEN
        try:
            with urllib.request.urlopen(base) as response:
                page = response.read().decode()
                self.assertIn('Ana &lt;Teste&gt;', page)
                self.assertIn('Preparar cobrança por email', page)
            payload = urllib.parse.urlencode(dict(csrf=app.TOKEN,id=1,modelo='primeiro_contato',operador='Teste')).encode()
            with urllib.request.urlopen(base + '/preview', payload) as response:
                page = response.read().decode()
                self.assertIn('Confirmar e enviar email', page)
                self.assertIn('ana@example.com', page)
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(base + '/send', b'csrf=errado')
            self.assertEqual(error.exception.code, 400)
        finally:
            server.shutdown()
            server.server_close()
            worker.join()


if __name__ == '__main__':
    unittest.main()
