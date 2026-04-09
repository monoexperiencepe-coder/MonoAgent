# Libera el puerto 3000 en Windows (PowerShell 5+ / Get-NetTCPConnection).
# Uso: powershell -ExecutionPolicy Bypass -File .\free-port-3000.ps1

$port = 3000

Write-Host "[1/3] Buscando quien escucha en el puerto $port..."
$listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue

if (-not $listeners) {
    Write-Host "      Puerto $port ya esta libre (no hay LISTEN)."
    exit 0
}

$pids = $listeners | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($procId in $pids) {
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    $label = if ($proc) { $proc.ProcessName } else { "desconocido" }
    Write-Host "      PID $procId ($label)"
}

Write-Host "[2/3] Terminando proceso(s)..."
foreach ($procId in $pids) {
    try {
        Stop-Process -Id $procId -Force -ErrorAction Stop
        Write-Host "      PID $procId terminado."
    } catch {
        Write-Host "      No se pudo matar PID $procId : $_"
        Write-Host "      Prueba abrir PowerShell como Administrador."
        exit 1
    }
}

Start-Sleep -Seconds 1

Write-Host "[3/3] Comprobando de nuevo el puerto $port..."
$still = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($still) {
    Write-Host "      ADVERTENCIA: Sigue habiendo LISTEN en $port. Cierra el programa manualmente o usa otra terminal elevada."
    exit 1
}

Write-Host "      Puerto $port libre. Ya puedes ejecutar: node server.js"
exit 0
