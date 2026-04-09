# Libera el puerto 3000 si esta en uso y luego ejecuta node server.js
# Uso:
#   powershell -ExecutionPolicy Bypass -File .\run-server-3000.ps1

$ErrorActionPreference = "Stop"
$port = 3000

Write-Host "=== [1/5] Verificando puerto $port ==="
$listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue

if ($listeners) {
    Write-Host "Puerto $port en uso. Procesos detectados:"
    $pids = $listeners | Select-Object -ExpandProperty OwningProcess -Unique

    foreach ($procId in $pids) {
        $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
        $name = if ($proc) { $proc.ProcessName } else { "desconocido" }
        Write-Host (" - PID {0} ({1})" -f $procId, $name)
    }

    Write-Host "=== [2/5] Terminando procesos ==="
    foreach ($procId in $pids) {
        try {
            Stop-Process -Id $procId -Force -ErrorAction Stop
            Write-Host ("   OK: PID {0} terminado" -f $procId)
        } catch {
            Write-Host ("   ERROR: no se pudo terminar PID {0}" -f $procId)
            Write-Host "   Detalle: $($_.Exception.Message)"
            Write-Host "   Sugerencia: abre PowerShell como Administrador y vuelve a intentar."
            exit 1
        }
    }

    Write-Host "=== [3/5] Esperando liberacion del puerto ==="
    Start-Sleep -Seconds 1
} else {
    Write-Host "Puerto $port ya estaba libre."
}

Write-Host "=== [4/5] Verificacion final ==="
$stillListening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($stillListening) {
    Write-Host "ERROR: el puerto $port sigue en uso."
    Write-Host "Sugerencia: ejecuta esta terminal como Administrador."
    exit 1
}
Write-Host "Puerto $port libre."

Write-Host "=== [5/5] Iniciando servidor Node ==="
Write-Host "Comando: node server.js"
Write-Host "(El proceso quedara corriendo en esta misma terminal)"
node server.js
