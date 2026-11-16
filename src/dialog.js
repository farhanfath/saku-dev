export function confirmAction(title, description, action) {
  const dialog = document.getElementById('confirm-dialog');
  if (dialog.open) return Promise.resolve(false);
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-description').textContent = description;
  document.getElementById('confirm-accept').textContent = action;
  dialog.returnValue = 'cancel';
  dialog.showModal();
  return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'accept'), { once: true }));
}
