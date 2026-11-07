"""Not-Aus im Auftragsdienst (Zentrale 1.4.0, E72): Tunnel stoppen, nichts einspielen – auch während lange Tests laufen."""
import importlib.util
import json
import subprocess
from pathlib import Path

SKRIPT = Path(__file__).resolve().parents[2] / "scripts" / "auftragsdienst.py"


def laden(tmp_path, monkeypatch):
    monkeypatch.setenv("SB_LIVE", str(tmp_path / "live"))
    monkeypatch.setenv("SB_PROBE", str(tmp_path / "probe"))
    monkeypatch.setenv("SB_SPERRE", str(tmp_path / "sperre.lock"))
    spec = importlib.util.spec_from_file_location("auftragsdienst_test", SKRIPT)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_notaus_stoppt_tunnel_und_sperrt_deploy(tmp_path, monkeypatch):
    m = laden(tmp_path, monkeypatch)
    (tmp_path / "live/config").mkdir(parents=True)
    befehle = []
    monkeypatch.setattr(m, "lauft", lambda c: c == m.TUNNEL_C)
    monkeypatch.setattr(m.subprocess, "run", lambda b, **k: befehle.append(b) or subprocess.CompletedProcess(b, 0, "", ""))
    m.notaus()
    assert befehle == []                                             # ohne Not-Aus: nichts
    (tmp_path / "live/config/notaus.json").write_text(json.dumps({"zeit": "x", "von": "seb"}))
    m.notaus()
    assert befehle == [["docker", "stop", m.TUNNEL_C]]
    # Deploy nach Freigabe tut nichts – liest nicht einmal die Freigabe
    monkeypatch.setattr(m, "lesen", lambda p: (_ for _ in ()).throw(AssertionError("darf nicht lesen")))
    m.deploy_nach_freigabe()


def test_notaus_auch_bei_laufender_sperre(tmp_path, monkeypatch):
    """Lange Tests halten die Sperre bis zu 45 Minuten – der Not-Aus darf darauf nicht warten."""
    import fcntl
    m = laden(tmp_path, monkeypatch)
    (tmp_path / "live/config").mkdir(parents=True)
    (tmp_path / "live/config/notaus.json").write_text("{}")
    befehle = []
    monkeypatch.setattr(m, "lauft", lambda c: c == m.TUNNEL_C)
    monkeypatch.setattr(m.subprocess, "run", lambda b, **k: befehle.append(b) or subprocess.CompletedProcess(b, 0, "", ""))
    with open(tmp_path / "sperre.lock", "w") as f:
        fcntl.flock(f, fcntl.LOCK_EX)                                # „Tests laufen noch“
        assert m.main() == 0
    assert ["docker", "stop", m.TUNNEL_C] in befehle
