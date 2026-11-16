let pending = null;

export async function confirmAction(title, description, action) {
  const dialog = document.getElementById('confirm-dialog');
  if (dialog.open) return false;
  if (pending) await pending;
  if (dialog.open) return false;
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-description').textContent = description;
  document.getElementById('confirm-accept').textContent = action;
  dialog.returnValue = 'cancel';
  dialog.showModal();
  pending = new Promise(resolve => dialog.addEventListener('close', () => {
    const accepted = dialog.returnValue === 'accept';
    pending = null;
    resolve(accepted);
  }, { once: true }));
  return pending;
}
