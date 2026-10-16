import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Modal } from './Modal.tsx'

function Host({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button onClick={() => setOpen(true)}>open it</button>
      {open && (
        <Modal title="Test dialog" onClose={() => { setOpen(false); onClose() }}>
          <input aria-label="first" /><button>middle</button><button>last</button>
        </Modal>
      )}
    </div>
  )
}

describe('Modal', () => {
  it('is a labelled dialog, focuses its first field, and hands focus back when closed', async () => {
    render(<Host />)
    const opener = screen.getByRole('button', { name: 'open it' })
    await userEvent.click(opener)
    expect(screen.getByRole('dialog', { name: 'Test dialog' })).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByLabelText('first')).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(opener).toHaveFocus()
  })

  it('keeps Tab inside the dialog', async () => {
    render(<Host />)
    await userEvent.click(screen.getByRole('button', { name: 'open it' }))
    const last = screen.getByRole('button', { name: 'last' })
    last.focus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus() // wrapped round to the first control
    await userEvent.tab({ shift: true })
    expect(last).toHaveFocus()
  })

  it('closes from the × button and from a click outside, but not from a click inside', async () => {
    const onClose = vi.fn()
    render(<Host onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'open it' }))
    await userEvent.click(screen.getByLabelText('first'))
    expect(onClose).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'open it' }))
    const backdrop = document.querySelector('.modal-backdrop') as HTMLElement
    await userEvent.pointer([{ target: backdrop, keys: '[MouseLeft]' }])
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
