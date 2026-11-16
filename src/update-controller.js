export function createUpdateController({ check, onState, canInstall, setLocked, install }) {
  let update = null;
  let operation = false;
  let dismissed = false;
  let state = { status: 'idle' };

  function publish(next) {
    state = next;
    onState(next);
  }

  async function checkForUpdate(manual = false) {
    if (operation || (dismissed && !manual)) return;
    if (manual) dismissed = false;
    operation = true;
    publish({ status: 'checking', manual });
    try {
      await update?.close();
      update = await check();
      publish(update
        ? { status: 'available', version: update.version, notes: update.body || '' }
        : { status: 'up-to-date' });
    } catch {
      publish({ status: 'error', message: 'Tidak bisa memeriksa pembaruan. Periksa koneksi internet lalu coba lagi.' });
    } finally {
      operation = false;
    }
  }

  async function download() {
    if (operation || !update || state.status !== 'available') return;
    operation = true;
    publish({ status: 'downloading', version: update.version, notes: update.body || '', received: 0, total: null });
    try {
      await update.download(event => {
        if (event.event === 'Started') publish({ status: 'downloading', version: update.version, notes: update.body || '', received: 0, total: event.data.contentLength });
        if (event.event === 'Progress') {
          const current = state.status === 'downloading' ? state : { received: 0, total: null };
          publish({ status: 'downloading', version: update.version, notes: update.body || '', received: current.received + event.data.chunkLength, total: current.total });
        }
      });
      if (state.status !== 'ready') publish({ status: 'ready', version: update.version, notes: update.body || '' });
    } catch {
      await update.close().catch(() => {});
      update = null;
      publish({ status: 'error', message: 'Unduhan gagal. Periksa koneksi internet lalu coba lagi.' });
    } finally {
      operation = false;
    }
  }

  async function installUpdate() {
    if (operation || !update || state.status !== 'ready') return;
    const blocked = canInstall();
    if (blocked) {
      publish({ status: 'ready', version: update.version, notes: update.body || '', message: blocked });
      return;
    }
    operation = true;
    setLocked(true);
    publish({ status: 'installing', version: update.version, notes: update.body || '' });
    try {
      await install(update);
      publish({ status: 'installed', version: update.version });
    } catch {
      setLocked(false);
      publish({ status: 'ready', version: update.version, notes: update.body || '', message: 'Pemasangan gagal. File dan perubahan Anda tetap aman; coba lagi.' });
    } finally {
      operation = false;
    }
  }

  async function later() {
    if (operation) return;
    operation = true;
    dismissed = true;
    publish({ status: 'dismissed' });
    try { await update?.close().catch(() => {}); }
    finally { update = null; operation = false; }
  }

  return { check: checkForUpdate, download, install: installUpdate, later, get state() { return state; } };
}
