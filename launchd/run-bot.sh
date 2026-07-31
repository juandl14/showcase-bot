#!/bin/zsh
# Wrapper que lanza launchd. Resuelve la carpeta del proyecto sola (no hace
# falta editar rutas acá), pero el binario de node SÍ hay que fijarlo abajo —
# ver la nota.

# Carpeta del proyecto = un nivel arriba de donde vive este script.
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR" || exit 1

# launchd NO carga tu .zshrc/.zprofile, así que el PATH acá es el mínimo del
# sistema — "node" a secas probablemente no se encuentre, y si usás nvm,
# CUALQUIER "node" que sí encuentre va a ser el equivocado. Poné la ruta
# ABSOLUTA a tu binario real:
#
#   which node
#
# y pegala acá abajo. Con nvm suele ser algo como:
#   /Users/tu-usuario/.nvm/versions/node/vXX.X.X/bin/node
NODE_BIN="node"   # <-- reemplazá esto por la ruta absoluta

echo "===== arranque launchd: $(date) ====="
exec "$NODE_BIN" --env-file=.env bot.mjs
