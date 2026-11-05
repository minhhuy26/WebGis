$ErrorActionPreference = "Stop"

Write-Host "Dang khoi dong lai dich vu PostgreSQL (che do trust)..." -ForegroundColor Cyan
Start-Service postgresql-x64-18
Start-Sleep -Seconds 2

Write-Host "Dang cap nhat mat khau cho user postgres ve 'nguyenhuy2006'..." -ForegroundColor Cyan
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -h 127.0.0.1 -p 5432 -U postgres -d postgres -c "ALTER USER postgres WITH PASSWORD 'nguyenhuy2006';"

Write-Host "Dang khoi phuc cau hinh bao mat pg_hba.conf ve scram-sha-256..." -ForegroundColor Cyan
python -c "
path = r'C:\Program Files\PostgreSQL\18\data\pg_hba.conf'
with open(path, 'r', encoding='utf-8') as f:
    text = f.read()
text = text.replace('host all all 127.0.0.1/32 trust', 'host    all             all             127.0.0.1/32            scram-sha-256')
text = text.replace('host all all ::1/128 trust', 'host    all             all             ::1/128                 scram-sha-256')
with open(path, 'w', encoding='utf-8', newline='\n') as f:
    f.write(text)
print('Da khoi phuc bao mat thanh cong!')
"

Write-Host "Dang khoi dong lai dich vu PostgreSQL lan cuoi de ap dung mat khau moi..." -ForegroundColor Cyan
Restart-Service postgresql-x64-18
Start-Sleep -Seconds 2

Write-Host "========================================================" -ForegroundColor Green
Write-Host "HOAN TAT! Mat khau postgres da duoc dat ve: nguyenhuy2006" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
Start-Sleep -Seconds 3
