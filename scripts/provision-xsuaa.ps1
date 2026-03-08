param(
    [string]$ServiceName = "dscp-ai-app",
    [string]$AppName = "dscp-ai",
    [string]$SecurityFile = "xs-security.json"
)

$ErrorActionPreference = "Stop"

function Assert-CfCli {
    if (-not (Get-Command cf -ErrorAction SilentlyContinue)) {
        throw "Cloud Foundry CLI (cf) is not installed or not in PATH."
    }
}

function Assert-FileExists([string]$Path) {
    if (-not (Test-Path $Path)) {
        throw "Required file not found: $Path"
    }
}

function Wait-XsuaaOperation([string]$Name, [int]$MaxAttempts = 40, [int]$DelaySeconds = 6) {
    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        $svc = cf service $Name | Out-String
        if ($LASTEXITCODE -ne 0) {
            throw "Unable to fetch service status for '$Name'."
        }

        if ($svc -match "status:\s+(create succeeded|update succeeded)") {
            Write-Host "XSUAA service '$Name' is ready." -ForegroundColor Green
            return
        }

        if ($svc -match "status:\s+(create failed|update failed)") {
            throw "XSUAA operation failed for '$Name'. Check: cf service $Name"
        }

        Write-Host "Waiting for XSUAA operation ($attempt/$MaxAttempts)..." -ForegroundColor Yellow
        Start-Sleep -Seconds $DelaySeconds
    }

    throw "Timed out waiting for XSUAA operation to finish for '$Name'."
}

Assert-CfCli
Assert-FileExists $SecurityFile

Write-Host "Checking CF target..." -ForegroundColor Cyan
$target = cf target | Out-String
if ($LASTEXITCODE -ne 0) {
    throw "Not logged into Cloud Foundry. Run 'cf login' first."
}

Write-Host "Provisioning XSUAA from $SecurityFile..." -ForegroundColor Cyan
cf service $ServiceName *> $null

if ($LASTEXITCODE -eq 0) {
    Write-Host "Service exists. Updating '$ServiceName' with '$SecurityFile'..." -ForegroundColor Cyan
    cf update-service $ServiceName -c $SecurityFile
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to update service '$ServiceName'."
    }
} else {
    Write-Host "Service not found. Creating '$ServiceName' (xsuaa/application)..." -ForegroundColor Cyan
    cf create-service xsuaa application $ServiceName -c $SecurityFile
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create service '$ServiceName'."
    }
}

Wait-XsuaaOperation -Name $ServiceName

Write-Host "Ensuring service binding to app '$AppName'..." -ForegroundColor Cyan
cf bind-service $AppName $ServiceName
if ($LASTEXITCODE -ne 0) {
    Write-Host "Binding may already exist or app may be missing. Continuing to restage." -ForegroundColor Yellow
}

Write-Host "Restaging app '$AppName'..." -ForegroundColor Cyan
cf restage $AppName
if ($LASTEXITCODE -ne 0) {
    throw "Failed to restage app '$AppName'."
}

Write-Host "Done. Next: create role collections in BTP cockpit and assign users/groups." -ForegroundColor Green
