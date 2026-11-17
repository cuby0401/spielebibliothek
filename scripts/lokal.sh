# Wird von den Shell-Skripten eingebunden (. scripts/lokal.sh): liest lokal.env im Repo-Wurzelordner.
# Dort stehen die Adressen der eigenen NAS – sie gehören nicht ins Git (Repo ist öffentlich, Vorlage: lokal.env.example).
# Schon gesetzte Umgebungsvariablen gehen vor. Ohne lokal.env bleibt alles leer; wer die NAS braucht, ruft nas_noetig auf.
_lokal_datei="$(cd "$(dirname "$0")/.." && pwd)/lokal.env"
if [ -f "$_lokal_datei" ]; then
	while IFS='=' read -r _k _v || [ -n "$_k" ]; do
		case "$_k" in ''|\#*|*[!A-Z0-9_]*) continue ;; esac
		eval "[ -n \"\${$_k:-}\" ] || $_k=\$_v"
	done < "$_lokal_datei"
fi
NAS="${NAS:-}"; NAS_GH="${NAS_GH:-}"; NAS_PH="${NAS_PH:-}"; NAS_UH="${NAS_UH:-}"
nas_noetig() {
	[ -n "$NAS" ] && [ -n "$NAS_GH" ] && [ -n "$NAS_PH" ] && [ -n "$NAS_UH" ] && return 0
	echo "✗ NAS-Adressen fehlen: lokal.env im Repo-Wurzelordner anlegen (Vorlage lokal.env.example)." >&2
	exit 1
}
