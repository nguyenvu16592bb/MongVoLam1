# Ghep mongvolam.html tu src/ + lib/ (three.js r128, pixi 8.6.6 inline)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'src'
$lib = Join-Path $root 'lib'
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Read-Text([string]$p) {
  $t = [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8)
  return $t.TrimStart([char]0xFEFF)
}

$style = Read-Text (Join-Path $src 'style.css')
$parts = @('01-data.js', '02-world.js', '03-battle.js', '03b-arenas.js', '04-info.js', '05-ui.js', '06-boot.js')
$jsParts = foreach ($f in $parts) { Read-Text (Join-Path $src $f) }
$js = "(function(){`n" + ($jsParts -join "`n") + "`n})();"

$three = Read-Text (Join-Path $lib 'three.min.js')
$pixi = Read-Text (Join-Path $lib 'pixi.min.js')
$tpl = Read-Text (Join-Path $src 'index.template.html')

if ($three -match '</script') { throw 'three.min.js chua </script' }
if ($pixi -match '</script') { throw 'pixi.min.js chua </script' }

$out = $tpl.Replace('__STYLE__', $style).Replace('__THREE__', $three).Replace('__PIXI__', $pixi).Replace('__GAME__', $js)

$dest = Join-Path $root 'mongvolam.html'
[System.IO.File]::WriteAllText($dest, $out, $utf8)

$chkDir = Join-Path $root '.zwork\build'
New-Item -ItemType Directory -Force -Path $chkDir | Out-Null
[System.IO.File]::WriteAllText((Join-Path $chkDir 'game.js'), $js, $utf8)

"OK -> $dest ($([math]::Round((Get-Item $dest).Length / 1KB)) KB, js $([math]::Round($js.Length / 1KB)) KB)"
