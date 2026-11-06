param(
    [string]$MsiDirectory = (Join-Path $PSScriptRoot '../packaging/dist')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$packages = @(Get-ChildItem -LiteralPath $MsiDirectory -Filter '*.msi' -File)
if ($packages.Count -ne 1) {
    throw "Expected exactly one Windows installer in $MsiDirectory; found $($packages.Count)."
}

$temporaryRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$smokeRoot = Join-Path $temporaryRoot ("detweave-msi-smoke-" + [Guid]::NewGuid().ToString('N'))
$null = New-Item -Path $smokeRoot -ItemType Directory
$installed = Join-Path $smokeRoot 'installed'
$installerLog = Join-Path $smokeRoot 'msiexec.log'
$appStdout = Join-Path $smokeRoot 'stdout.log'
$appStderr = Join-Path $smokeRoot 'stderr.log'
$app = $null

try {
    $msi = $packages[0].FullName
    # INSTALLFOLDER is the public installation directory in the Briefcase WiX template.
    $arguments = "/i `"$msi`" /qn /norestart /L*v `"$installerLog`" INSTALLFOLDER=`"$installed`""
    $installer = Start-Process -FilePath 'msiexec.exe' -ArgumentList $arguments -Wait -PassThru
    if ($installer.ExitCode -notin @(0, 3010)) {
        throw "MSI installation failed with exit code $($installer.ExitCode)."
    }

    $executable = Join-Path $installed 'DetWeave.exe'
    if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
        $launchers = @(Get-ChildItem -LiteralPath $installed -Filter 'DetWeave.exe' -File -Recurse)
        if ($launchers.Count -ne 1) {
            throw "Expected one installed DetWeave.exe in $installed; found $($launchers.Count)."
        }
        $executable = $launchers[0].FullName
    }
    Write-Host "Installed MSI and launching $executable."
    $app = Start-Process -FilePath $executable -WorkingDirectory (Split-Path -Parent $executable) `
        -RedirectStandardOutput $appStdout -RedirectStandardError $appStderr -PassThru

    $address = $null
    $health = $null
    $lastRequestError = 'No process-owned loopback listener appeared.'
    $deadline = (Get-Date).AddSeconds(45)
    while ((Get-Date) -lt $deadline) {
        $app.Refresh()
        if ($app.HasExited) {
            throw "The installed executable exited before startup checks (exit code $($app.ExitCode))."
        }
        $listeners = @(Get-NetTCPConnection -State Listen -OwningProcess $app.Id -LocalAddress '127.0.0.1' -ErrorAction SilentlyContinue)
        foreach ($listener in $listeners) {
            $candidate = "http://127.0.0.1:$($listener.LocalPort)"
            try {
                $response = Invoke-RestMethod -Uri "$candidate/api/health" -TimeoutSec 3 -NoProxy
                if ($response.status -eq 'ok' -and $response.version) {
                    $address = $candidate
                    $health = $response
                    break
                }
                $lastRequestError = "Unexpected health response at $candidate."
            } catch {
                $lastRequestError = $_.Exception.Message
            }
        }
        if ($address -and $app.MainWindowHandle -ne [IntPtr]::Zero) { break }
        Start-Sleep -Milliseconds 500
    }

    $app.Refresh()
    if ($app.HasExited) {
        throw "The installed executable exited during startup (exit code $($app.ExitCode))."
    }
    if (-not $address) {
        throw "The installed process did not expose a healthy loopback service in 45 seconds. $lastRequestError"
    }
    if ($app.MainWindowHandle -eq [IntPtr]::Zero) {
        throw "The service started, but no native main window appeared (session $($app.SessionId); interactive=$([Environment]::UserInteractive))."
    }

    $examples = Invoke-RestMethod -Uri "$address/api/examples" -TimeoutSec 10 -NoProxy
    if (-not $examples -or -not $examples[0].model) {
        throw 'The installed application did not return a bundled geometry example.'
    }
    $payload = ConvertTo-Json -InputObject @{ model = $examples[0].model } -Depth 100 -Compress
    $report = Invoke-RestMethod -Uri "$address/api/validate" -Method Post -TimeoutSec 10 -NoProxy `
        -Headers @{ 'X-DetWeave' = '1' } -ContentType 'application/json; charset=utf-8' `
        -Body ([Text.Encoding]::UTF8.GetBytes($payload))
    if (-not $report.ready -or -not $report.instances -or $report.checks.schema -ne 'passed') {
        throw 'The installed application failed to validate its bundled geometry example.'
    }
    Write-Host "Installed DetWeave $($health.version) opened a native window and validated $(@($report.instances).Count) fixture instances."
}
catch {
    foreach ($log in @($installerLog, $appStdout, $appStderr)) {
        if (Test-Path -LiteralPath $log -PathType Leaf) {
            Write-Host "Last lines of $log"
            Get-Content -LiteralPath $log -Tail 40 | Write-Host
        }
    }
    throw
}
finally {
    if ($null -ne $app -and -not $app.HasExited) {
        Stop-Process -Id $app.Id -Force
    }
}
