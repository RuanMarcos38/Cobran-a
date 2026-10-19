$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$credentialPath = Join-Path $PSScriptRoot 'smtp-credencial.xml'
Write-Host 'Cobranca por email - Hostinger'
Write-Host 'Conta: cobranca@rrestrategiaperformance.com.br'
Write-Host 'A senha sera protegida pelo Windows e vinculada a este usuario neste computador.'
try {
    if (Test-Path -LiteralPath $credentialPath) {
        $mailCredential = Import-Clixml -LiteralPath $credentialPath
    } else {
        $mailSecret = Read-Host 'Digite a senha DA CAIXA POSTAL (nao a senha do hPanel)' -AsSecureString
        $mailCredential = [System.Management.Automation.PSCredential]::new('cobranca@rrestrategiaperformance.com.br', $mailSecret)
    }
    $env:SMTP_PASSWORD = $mailCredential.GetNetworkCredential().Password
    python app.py --check-smtp
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'Configuracao nao concluida. Nada foi enviado.'
        Write-Host 'Se a senha salva mudou, remova apenas smtp-credencial.xml desta pasta e abra novamente.'
        exit 1
    }
    $mailCredential | Export-Clixml -LiteralPath $credentialPath
    Write-Host 'Configuracao salva. Abrindo a tela de cobranca. Mantenha esta janela aberta.'
    $env:PORT = '0'
    python app.py --open
} finally {
    Remove-Item Env:SMTP_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:PORT -ErrorAction SilentlyContinue
    $mailCredential = $null
    $mailSecret = $null
}
