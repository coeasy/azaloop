$rows = @()
$files = Get-ChildItem -Path packages -Recurse -Filter '*.ts' -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch 'node_modules|\\dist\\|\\test\\' }
foreach ($f in $files) {
  $lines = (Get-Content $f.FullName -ErrorAction SilentlyContinue).Count
  if ($lines -gt 600) {
    $rel = $f.FullName.Replace('p:\github_public\azaloop\', '')
    $rows += [PSCustomObject]@{ Lines = $lines; Path = $rel }
  }
}
$rows | Sort-Object Lines -Descending | Format-Table -AutoSize
