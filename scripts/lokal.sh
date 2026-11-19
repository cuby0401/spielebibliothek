# Wird von den Shell-Skripten eingebunden (. scripts/lokal.sh): liest lokal.env im Repo-Wurzelordner.
# Dort stehen die Adressen der eigenen Server – sie gehören nicht ins Git (Repo ist öffentlich, Vorlage: lokal.env.example).
# Schon gesetzte Umgebungsvariablen gehen vor. Ohne lokal.env bleibt alles leer; wer den Server braucht, ruft server_noetig auf.
#
# SERVER_ORT wählt, wo die Zentrale läuft (seit 20.11.2026):
#   nas  NAS mit UGOS – alles unter /volume1 (bis 20.11.2026)
#   vm   Docker-VM – Stack und Datenbanken lokal unter /opt/stacks, Spiele per SMB von der NAS unter /mnt/nas/games
# Daraus folgen SERVER (ssh-Ziel), SERVER_GH/PH/UH (drei Namen für den Teststand), SERVER_LAN und die Pfade SB_*.
_lokal_datei="$(cd "$(dirname "$0")/.." && pwd)/lokal.env"
if [ -f "$_lokal_datei" ]; then
	while IFS='=' read -r _k _v || [ -n "$_k" ]; do
		case "$_k" in ''|\#*|*[!A-Z0-9_]*) continue ;; esac
		eval "[ -n \"\${$_k:-}\" ] || $_k=\$_v"
	done < "$_lokal_datei"
fi
NAS="${NAS:-}"; NAS_GH="${NAS_GH:-}"; NAS_PH="${NAS_PH:-}"; NAS_UH="${NAS_UH:-}"; NAS_LAN="${NAS_LAN:-}"
VM="${VM:-}"; VM_GH="${VM_GH:-}"; VM_PH="${VM_PH:-}"; VM_UH="${VM_UH:-}"; VM_LAN="${VM_LAN:-}"
SERVER_ORT="${SERVER_ORT:-nas}"

# Pfade je Ort – nur Pfade, keine Adressen. Gleiche Namen wie auf dem Server (nas-deploy.sh, teststand.sh, Auftragsdienst).
case "$SERVER_ORT" in
	nas)
		SERVER="$NAS"; SERVER_GH="$NAS_GH"; SERVER_PH="$NAS_PH"; SERVER_UH="$NAS_UH"; SERVER_LAN="$NAS_LAN"
		SB_ABLAGE=/volume1/docker
		SB_SPIELE=/volume1/games/spiele
		SB_DATEN=/volume1/games/data
		SB_UDATEN=/volume1/games/filebrowser/upload ;;
	vm)
		SERVER="$VM"; SERVER_GH="$VM_GH"; SERVER_PH="$VM_PH"; SERVER_UH="$VM_UH"; SERVER_LAN="$VM_LAN"
		SB_ABLAGE=/opt/stacks
		SB_SPIELE=/mnt/nas/games/spiele
		SB_DATEN=/opt/stacks/spielebibliothek-daten/data
		SB_UDATEN=/opt/stacks/spielebibliothek-daten/upload ;;
	*) echo "✗ SERVER_ORT in lokal.env muss nas oder vm sein, ist: $SERVER_ORT" >&2; exit 1 ;;
esac
SB_STACK=$SB_ABLAGE/spielebibliothek
SB_RELEASES=$SB_ABLAGE/spielebibliothek-releases
SB_QUELLE=$SB_ABLAGE/spielebibliothek-quelle
SB_PROBE=$SB_ABLAGE/spielebibliothek-probe
# Für teststand.sh auf dem Server: Pfade und LAN-Adresse der Probe (die Tunnel-Routen des Testservers zeigen dorthin)
SB_UMGEBUNG="SB_ABLAGE=$SB_ABLAGE SB_STACK=$SB_STACK SB_SPIELE=$SB_SPIELE SB_DATEN=$SB_DATEN SB_UDATEN=$SB_UDATEN LAN=$SERVER_LAN"

server_noetig() {
	[ -n "$SERVER" ] && [ -n "$SERVER_LAN" ] && return 0
	echo "✗ Adressen für SERVER_ORT=$SERVER_ORT fehlen in lokal.env (ssh-Ziel und LAN-Adresse, Vorlage lokal.env.example)." >&2
	exit 1
}
# Drei Namen des Servers – nur für den Teststand auf dem Server (Ende-zu-Ende ohne Docker Desktop) und die Design-Spielwiese
namen_noetig() {
	[ -n "$SERVER_GH" ] && [ -n "$SERVER_PH" ] && [ -n "$SERVER_UH" ] && return 0
	echo "✗ Drei Namen des Servers für SERVER_ORT=$SERVER_ORT fehlen in lokal.env (…_GH, …_PH, …_UH, Vorlage lokal.env.example)." >&2
	exit 1
}
# Eigene Adressen aus lokal.env, die in keiner Datei des Repos stehen dürfen (deploy.sh prüft das).
# Reine Kleinbuchstaben-Wörter (z. B. ein Kurzname wie „docker“) sind zu allgemein dafür und werden ausgelassen.
adressen() {
	for _a in "$NAS_GH" "$NAS_PH" "$NAS_UH" "$NAS_LAN" "$VM_GH" "$VM_PH" "$VM_UH" "$VM_LAN" "${NAS#*@}" "${VM#*@}"; do
		case "$_a" in ''|*[!a-z]*) [ -n "$_a" ] && printf '%s\n' "$_a" ;; esac
	done | sort -u
}
