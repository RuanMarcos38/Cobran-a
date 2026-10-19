"""Módulo local de cobrança. Python 3.10+, sem dependências externas."""
import hashlib
import hmac
import html
import json
import os
import re
import secrets
import smtplib
import sqlite3
import ssl
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
DB = ROOT / 'cobranca-local.sqlite3'
FROM = 'cobranca@rrestrategiaperformance.com.br'
TOKEN = secrets.token_urlsafe(32)
MODELS = {m['id']: m for m in json.loads((ROOT / 'modelos.json').read_text(encoding='utf-8'))['modelos']}


class ClosingConnection(sqlite3.Connection):
    def __exit__(self, *args):
        try:
            return super().__exit__(*args)
        finally:
            self.close()


def connect():
    db = sqlite3.connect(DB, factory=ClosingConnection)
    db.row_factory = sqlite3.Row
    return db


def init():
    with connect() as db:
        db.executescript('''
        CREATE TABLE IF NOT EXISTS titles (
          id INTEGER PRIMARY KEY, nome TEXT NOT NULL, email TEXT NOT NULL,
          credor TEXT NOT NULL, cobradora TEXT NOT NULL, referencia TEXT NOT NULL,
          bordero TEXT NOT NULL, vencimento TEXT NOT NULL, valor TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'aberto');
        CREATE TABLE IF NOT EXISTS sends (
          id TEXT PRIMARY KEY, title_id INTEGER NOT NULL, template TEXT NOT NULL,
          recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
          snapshot TEXT NOT NULL, approval TEXT NOT NULL, operator TEXT NOT NULL,
          created TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'previa',
          message_id TEXT, updated TEXT, error TEXT);
        ''')


def esc(value):
    return html.escape(str(value), quote=True)


def validate_title(data):
    fields = ['nome', 'email', 'credor', 'cobradora', 'referencia', 'bordero', 'vencimento', 'valor']
    result = {k: str(data.get(k, '')).strip() for k in fields}
    if any(not v or len(v) > 300 or any(ord(c) < 32 for c in v) for v in result.values()):
        raise ValueError('Preencha todos os campos, sem quebras de linha.')
    if not re.fullmatch(r'[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+', result['email']):
        raise ValueError('Informe um único email válido do devedor.')
    date.fromisoformat(result['vencimento'])
    try:
        amount = Decimal(result['valor'].replace(',', '.'))
        if not amount.is_finite() or amount <= 0 or amount > Decimal('999999999999.99'):
            raise ValueError('Valor deve ser positivo e finito.')
        result['valor'] = str(amount.quantize(Decimal('.01')))
    except InvalidOperation:
        raise ValueError('Valor inválido. Use 1234,56, sem separador de milhar.')
    return result


def snapshot(title):
    return hashlib.sha256(json.dumps(dict(title), sort_keys=True).encode()).hexdigest()


def render(title, template_id, deadline='', approval='', operator=''):
    if title['status'] != 'aberto':
        raise ValueError('Título quitado, suspenso ou contestado: envio bloqueado.')
    if template_id not in MODELS:
        raise ValueError('Modelo inexistente.')
    model = MODELS[template_id]
    if model['exige_aprovacao_juridica'] and (len(approval.strip()) < 10 or not operator.strip()):
        raise ValueError('Registre o responsável jurídico e a referência da autorização real de ajuizamento.')
    amount = f"{Decimal(title['valor']):,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')
    values = dict(nome_devedor=title['nome'], empresa_cobradora=title['cobradora'],
                  empresa_credora=title['credor'], referencia=title['referencia'],
                  vencimento=date.fromisoformat(title['vencimento']).strftime('%d/%m/%Y'),
                  data_atualizacao=date.today().strftime('%d/%m/%Y'), valor_atualizado='R$ ' + amount)
    if 'prazo_resposta' in model['campos_obrigatorios']:
        limit = date.fromisoformat(deadline)
        if limit < date.today():
            raise ValueError('O prazo de resposta não pode estar no passado.')
        values['prazo_resposta'] = limit.strftime('%d/%m/%Y')
    return model['assunto'].format(**values), model['corpo'].format(**values)


def smtp_send(recipient, subject, body, message_id):
    password = os.environ.get('SMTP_PASSWORD', '')
    if not password:
        raise ValueError('Configure SMTP_PASSWORD no ambiente antes de enviar.')
    msg = EmailMessage()
    msg['From'] = formataddr(('Equipe de Cobrança', FROM))
    msg['Reply-To'] = FROM
    msg['To'] = recipient
    msg['Subject'] = subject
    msg['Message-ID'] = message_id
    msg.set_content(body)
    with smtplib.SMTP_SSL('smtp.hostinger.com', 465, context=ssl.create_default_context(), timeout=30) as smtp:
        smtp.login(FROM, password)
        refused = smtp.send_message(msg)
        if refused:
            raise ValueError('Destinatário recusado pelo servidor SMTP.')


def send_once(send_id, transport=smtp_send):
    if transport is smtp_send and not os.environ.get('SMTP_PASSWORD'):
        raise ValueError('Senha SMTP ainda não configurada. A prévia continua disponível.')
    now = datetime.now(timezone.utc).isoformat()
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        row = db.execute('SELECT * FROM sends WHERE id=?', (send_id,)).fetchone()
        if row is None or row['status'] != 'previa':
            raise ValueError('Essa prévia já foi utilizada ou não existe. Consulte o histórico.')
        title = db.execute('SELECT * FROM titles WHERE id=?', (row['title_id'],)).fetchone()
        if title is None or title['status'] != 'aberto' or snapshot(title) != row['snapshot']:
            raise ValueError('Título alterado ou bloqueado. Gere uma nova prévia.')
        recent = db.execute("SELECT 1 FROM sends WHERE title_id=? AND status IN ('enviando','aceito_smtp','incerto') AND updated>=?", (title['id'], now[:10])).fetchone()
        if recent:
            raise ValueError('Já existe envio ou tentativa pendente hoje para este título. Confira o histórico.')
        mid = make_msgid(domain='rrestrategiaperformance.com.br')
        db.execute("UPDATE sends SET status='enviando', message_id=?, updated=? WHERE id=?", (mid, now, send_id))
    try:
        transport(row['recipient'], row['subject'], row['body'], mid)
    except Exception:
        # Falha após DATA pode significar aceitação sem resposta: não repetir automaticamente.
        with connect() as db:
            db.execute("UPDATE sends SET status='incerto', error='Falha no SMTP; conferir a caixa postal antes de nova tentativa.' WHERE id=?", (send_id,))
        raise ValueError('Não foi possível confirmar o envio. Confira a caixa postal; não há repetição automática.')
    with connect() as db:
        db.execute("UPDATE sends SET status='aceito_smtp' WHERE id=?", (send_id,))


STYLE = '''body{font:16px system-ui;background:#f3f6fb;color:#172b4d;max-width:1080px;margin:40px auto;padding:0 20px}h1{margin-bottom:8px}section{background:white;padding:24px;border-radius:14px;margin:20px 0;box-shadow:0 2px 10px #142b4d0a}input,select,button{font:inherit;padding:10px;border:1px solid #cbd5e1;border-radius:7px;max-width:100%;box-sizing:border-box}label{display:block;margin:12px 0}label input,label select{display:block;width:100%;margin-top:5px}button{background:#155eef;color:white;cursor:pointer;margin:6px 0}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:12px 8px;border-bottom:1px solid #ddd}pre{white-space:pre-wrap;font:inherit;line-height:1.6}small{color:#52647c}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}.notice{padding:16px;background:#e7efff;border-radius:8px}a{color:#155eef}'''


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # Não registrar URL com token nem dados pessoais no console.

    def respond(self, body, status=200):
        page = '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cobranças por email</title><style>' + STYLE + '</style><h1>Cobranças por email</h1><small>Remetente: ' + FROM + '</small>' + body + '</html>'
        data = page.encode('utf-8')
        self.send_response(status)
        for key, value in [('Content-Type', 'text/html; charset=utf-8'), ('Content-Length', str(len(data))), ('Cache-Control', 'no-store'), ('Referrer-Policy', 'no-referrer'), ('X-Frame-Options', 'DENY'), ('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'")]:
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(data)

    def url(self, suffix=''):
        return '/' + TOKEN + suffix

    def form(self, action, body):
        return '<form method="post" action="' + self.url(action) + '"><input type="hidden" name="csrf" value="' + TOKEN + '">' + body + '</form>'

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path != self.url():
            return self.respond('Acesso inválido. Abra o endereço exibido ao iniciar o módulo.', 403)
        q = parse_qs(parsed.query).get('q', [''])[0][:200]
        with connect() as db:
            rows = db.execute('SELECT * FROM titles WHERE nome LIKE ? OR referencia LIKE ? OR bordero LIKE ? ORDER BY id DESC LIMIT 100', tuple('%' + q + '%' for _ in range(3))).fetchall()
            logs = db.execute('SELECT s.*, t.referencia FROM sends s JOIN titles t ON t.id=s.title_id ORDER BY s.created DESC LIMIT 30').fetchall()
        content = '<p class="notice">' + ('SMTP configurado no ambiente. Envio depende da autenticação na Hostinger.' if os.environ.get('SMTP_PASSWORD') else 'Modo de preparação: senha da caixa postal ainda não configurada. Você pode cadastrar títulos e revisar mensagens.') + '</p>'
        content += '<section><h2>Títulos dos devedores</h2><form method="get" action="' + self.url() + '"><input name="q" aria-label="Buscar" placeholder="Devedor, título ou borderô" value="' + esc(q) + '"><button>Buscar</button></form>'
        for t in rows:
            content += '<section><strong>' + esc(t['nome']) + '</strong><p>' + esc(t['credor']) + ' · Título ' + esc(t['referencia']) + ' · Borderô ' + esc(t['bordero']) + '</p><p>R$ ' + esc(t['valor']) + ' · ' + esc(t['vencimento']) + ' · ' + esc(t['status']) + '</p><small>' + esc(t['email']) + '</small>'
            content += self.form('/status', '<input type="hidden" name="id" value="' + str(t['id']) + '"><label>Situação<select name="status">' + ''.join('<option' + (' selected' if s == t['status'] else '') + '>' + s + '</option>' for s in ['aberto', 'quitado', 'contestado', 'suspenso']) + '</select></label><button>Atualizar situação</button>')
            if t['status'] == 'aberto':
                content += self.form('/preview', '<input type="hidden" name="id" value="' + str(t['id']) + '"><label>Modelo<select name="modelo">' + ''.join('<option value="' + esc(k) + '">' + esc(m['nome']) + '</option>' for k, m in MODELS.items()) + '</select></label><div class="grid"><label>Prazo de resposta (quando aplicável)<input type="date" name="prazo"></label><label>Nome do operador / responsável<input required name="operador" maxlength="200"></label></div><label>Referência da autorização jurídica (somente ajuizamento)<input name="aprovacao" maxlength="500" placeholder="Responsável, data e referência da aprovação"></label><button>Preparar cobrança por email</button>')
            content += '</section>'
        content += '</section><section><h2>Cadastrar título / borderô</h2><p>Cadastro local independente. Informe somente dados conferidos e o email do próprio devedor.</p>'
        labels = [('nome','Devedor','text'), ('email','Email do devedor','email'), ('credor','Empresa credora','text'), ('cobradora','Empresa cobradora (razão social)','text'), ('referencia','Referência do título / contrato','text'), ('bordero','Borderô','text'), ('vencimento','Vencimento','date'), ('valor','Valor atualizado (ex.: 1234,56)','text')]
        content += self.form('/create', '<div class="grid">' + ''.join('<label>' + label + '<input required maxlength="300" name="' + name + '" type="' + typ + '"></label>' for name, label, typ in labels) + '</div><button>Cadastrar título</button>')
        content += '</section><section><h2>Histórico recente</h2><p>Aceito pelo SMTP significa aceitação pelo servidor; não confirma entrega ou leitura. Envios incertos precisam de conferência manual.</p>'
        for log in logs:
            content += '<p><strong>' + esc(log['referencia']) + '</strong> · ' + esc(log['status']) + ' · ' + esc(log['created']) + '<br>' + esc(log['recipient']) + ' · Operador: ' + esc(log['operator']) + '<br><small>' + esc(log['message_id'] or '') + '</small></p>'
        self.respond(content + '</section>')

    def do_POST(self):
        try:
            if self.headers.get('Host') not in (f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'):
                raise ValueError('Host inválido.')
            origin = self.headers.get('Origin')
            if origin and origin != 'http://' + self.headers['Host']:
                raise ValueError('Origem inválida.')
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 20000:
                raise ValueError('Requisição inválida.')
            data = {k: v[0] for k, v in parse_qs(self.rfile.read(length).decode(), keep_blank_values=True).items()}
            if not hmac.compare_digest(data.get('csrf', ''), TOKEN):
                raise ValueError('Sessão inválida.')
            action = urlparse(self.path).path
            if action == self.url('/create'):
                title = validate_title(data)
                with connect() as db:
                    db.execute('INSERT INTO titles (' + ','.join(title) + ') VALUES (' + ','.join('?' for _ in title) + ')', tuple(title.values()))
            elif action == self.url('/status'):
                if data.get('status') not in ['aberto','quitado','contestado','suspenso']:
                    raise ValueError('Situação inválida.')
                with connect() as db:
                    db.execute('UPDATE titles SET status=? WHERE id=?', (data['status'], int(data['id'])))
            elif action == self.url('/preview'):
                with connect() as db:
                    t = db.execute('SELECT * FROM titles WHERE id=?', (int(data['id']),)).fetchone()
                    if not t:
                        raise ValueError('Título não encontrado.')
                    if not data.get('operador', '').strip():
                        raise ValueError('Identifique o operador.')
                    subject, body = render(t, data['modelo'], data.get('prazo',''), data.get('aprovacao',''), data['operador'])
                    sid = secrets.token_urlsafe(24)
                    db.execute('INSERT INTO sends (id,title_id,template,recipient,subject,body,snapshot,approval,operator,created) VALUES (?,?,?,?,?,?,?,?,?,?)', (sid,t['id'],data['modelo'],t['email'],subject,body,snapshot(t),data.get('aprovacao',''),data['operador'],datetime.now(timezone.utc).isoformat()))
                return self.respond('<section><h2>Revise antes de enviar</h2><p>Para: ' + esc(t['email']) + '</p><h3>' + esc(subject) + '</h3><pre>' + esc(body) + '</pre>' + self.form('/send', '<input type="hidden" name="envio" value="' + sid + '"><label><input style="width:auto;display:inline" type="checkbox" required name="confirmar" value="sim"> Conferi o destinatário, a dívida e o texto.</label><button>Confirmar e enviar email</button>') + '<p><a href="' + self.url() + '">Voltar sem enviar</a></p></section>')
            elif action == self.url('/send'):
                if data.get('confirmar') != 'sim':
                    raise ValueError('Confirme a revisão antes de enviar.')
                send_once(data['envio'])
            else:
                raise ValueError('Ação desconhecida.')
            self.respond('<section><p>Operação concluída. Consulte os títulos e o histórico.</p><a href="' + self.url() + '">Voltar à cobrança</a></section>')
        except (ValueError, KeyError, sqlite3.Error) as exc:
            self.respond('<section><p>' + esc(str(exc)) + '</p><a href="' + self.url() + '">Voltar à cobrança</a></section>', 400)


if __name__ == '__main__':
    init()
    server = HTTPServer(('127.0.0.1', int(os.environ.get('PORT', '8765'))), Handler)
    print('Abra somente neste computador: http://127.0.0.1:' + str(server.server_port) + '/' + TOKEN)
    print('Módulo local. Ctrl+C para encerrar. Não publique esta porta na internet.')
    server.serve_forever()
