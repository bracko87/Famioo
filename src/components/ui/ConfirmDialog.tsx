import { AlertTriangle, X } from 'lucide-react'

type ConfirmDialogProps = {
  open:boolean
  title:string
  message:string
  confirmLabel?:string
  cancelLabel?:string
  danger?:boolean
  busy?:boolean
  onConfirm:()=>void
  onCancel:()=>void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel='Confirm',
  cancelLabel='Cancel',
  danger=false,
  busy=false,
  onConfirm,
  onCancel,
}:ConfirmDialogProps) {
  if (!open) return null

  return (
    <div
      className="modal-backdrop confirm-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onCancel()
      }}
    >
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
        <header>
          <span className={danger ? 'confirm-dialog-icon danger' : 'confirm-dialog-icon'}>
            <AlertTriangle size={18} />
          </span>
          <div>
            <span className="eyebrow">CONFIRM ACTION</span>
            <h2 id="confirm-dialog-title">{title}</h2>
          </div>
          <button type="button" className="icon-button compact-icon" onClick={onCancel} disabled={busy} aria-label="Close confirmation">
            <X size={16} />
          </button>
        </header>

        <p>{message}</p>

        <footer>
          <button type="button" className="secondary-button compact" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button type="button" className={(danger ? 'secondary-button compact danger-button' : 'primary-button compact')} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  )
}
