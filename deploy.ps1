$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  锂电池企业智能诊断系统 - 部署脚本" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$deployDir = Join-Path $PSScriptRoot "deploy"
$htpasswdFile = Join-Path $deployDir ".htpasswd"

function New-Htpasswd {
    param(
        [string]$Username,
        [string]$Password
    )
    
    $salt = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 8 | ForEach-Object { [char]$_ })
    $hash = ConvertTo-SecureString $Password -AsPlainText -Force | ConvertFrom-SecureString
    
    $bytes = [System.Text.Encoding]::UTF8.GetBytes("$Username:$Password")
    $base64 = [Convert]::ToBase64String($bytes)
    
    return "$Username:$base64"
}

function Add-User {
    param(
        [string]$Username,
        [string]$Password
    )
    
    $entry = New-Htpasswd -Username $Username -Password $Password
    
    if (Test-Path $htpasswdFile) {
        $content = Get-Content $htpasswdFile -Raw
        $lines = $content -split "`n" | Where-Object { $_ -notmatch "^$Username:" }
        $lines += $entry
        $lines -join "`n" | Set-Content $htpasswdFile -NoNewline
    } else {
        $entry | Set-Content $htpasswdFile -NoNewline
    }
    
    Write-Host "[OK] 用户 '$Username' 已添加" -ForegroundColor Green
}

function Show-Menu {
    Write-Host ""
    Write-Host "请选择操作:" -ForegroundColor Yellow
    Write-Host "  1. 添加访问用户"
    Write-Host "  2. 删除访问用户"
    Write-Host "  3. 查看当前用户列表"
    Write-Host "  4. 构建并启动服务"
    Write-Host "  5. 停止服务"
    Write-Host "  6. 查看服务状态"
    Write-Host "  7. 查看服务日志"
    Write-Host "  8. 退出"
    Write-Host ""
}

function Remove-User {
    param([string]$Username)
    
    if (Test-Path $htpasswdFile) {
        $content = Get-Content $htpasswdFile
        $newContent = $content | Where-Object { $_ -notmatch "^$Username:" }
        $newContent | Set-Content $htpasswdFile
        Write-Host "[OK] 用户 '$Username' 已删除" -ForegroundColor Green
    } else {
        Write-Host "[ERROR] 密码文件不存在" -ForegroundColor Red
    }
}

function Show-Users {
    if (Test-Path $htpasswdFile) {
        Write-Host ""
        Write-Host "当前授权用户:" -ForegroundColor Yellow
        Get-Content $htpasswdFile | ForEach-Object {
            $username = ($_ -split ":")[0]
            Write-Host "  - $username"
        }
    } else {
        Write-Host "[INFO] 暂无授权用户" -ForegroundColor Yellow
    }
}

function Start-Services {
    Write-Host ""
    Write-Host "[INFO] 检查环境配置..." -ForegroundColor Yellow
    
    $envFile = Join-Path $PSScriptRoot ".env"
    if (-not (Test-Path $envFile)) {
        Write-Host "[WARN] .env 文件不存在，正在从模板创建..." -ForegroundColor Yellow
        $envExample = Join-Path $PSScriptRoot ".env.example"
        if (Test-Path $envExample) {
            Copy-Item $envExample $envFile
            Write-Host "[OK] .env 文件已创建，请编辑该文件配置 API Key" -ForegroundColor Green
        }
    }
    
    if (-not (Test-Path $htpasswdFile)) {
        Write-Host "[ERROR] 请先添加至少一个访问用户 (选项 1)" -ForegroundColor Red
        return
    }
    
    Write-Host "[INFO] 构建并启动服务..." -ForegroundColor Yellow
    Push-Location $PSScriptRoot
    try {
        docker-compose up -d --build
        Write-Host ""
        Write-Host "[OK] 服务已启动!" -ForegroundColor Green
        Write-Host ""
        Write-Host "访问地址: http://localhost" -ForegroundColor Cyan
        Write-Host "健康检查: http://localhost/api/health" -ForegroundColor Cyan
    } finally {
        Pop-Location
    }
}

function Stop-Services {
    Write-Host "[INFO] 停止服务..." -ForegroundColor Yellow
    Push-Location $PSScriptRoot
    try {
        docker-compose down
        Write-Host "[OK] 服务已停止" -ForegroundColor Green
    } finally {
        Pop-Location
    }
}

function Show-Status {
    Push-Location $PSScriptRoot
    try {
        docker-compose ps
    } finally {
        Pop-Location
    }
}

function Show-Logs {
    Push-Location $PSScriptRoot
    try {
        docker-compose logs -f --tail=100
    } finally {
        Pop-Location
    }
}

while ($true) {
    Show-Menu
    $choice = Read-Host "请输入选项 (1-8)"
    
    switch ($choice) {
        "1" {
            $username = Read-Host "请输入用户名"
            if ([string]::IsNullOrWhiteSpace($username)) {
                Write-Host "[ERROR] 用户名不能为空" -ForegroundColor Red
                continue
            }
            $password = Read-Host "请输入密码" -AsSecureString
            $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
                [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
            )
            Add-User -Username $username -Password $plainPassword
        }
        "2" {
            $username = Read-Host "请输入要删除的用户名"
            Remove-User -Username $username
        }
        "3" {
            Show-Users
        }
        "4" {
            Start-Services
        }
        "5" {
            Stop-Services
        }
        "6" {
            Show-Status
        }
        "7" {
            Show-Logs
        }
        "8" {
            Write-Host "再见!" -ForegroundColor Green
            exit 0
        }
        default {
            Write-Host "[ERROR] 无效选项，请重新选择" -ForegroundColor Red
        }
    }
}
