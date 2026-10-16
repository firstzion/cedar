import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthError, UnreachableError } from '@ssl/haystack'

const mocks = vi.hoisted(() => ({
  client: {
    isLoggedIn: false,
    login: vi.fn(),
    logout: vi.fn(),
    about: vi.fn(),
    read: vi.fn(),
  },
}))
vi.mock('../lib/client.ts', () => ({ client: mocks.client, onAuthLost: vi.fn() }))

import { App } from '../App.tsx'
import { AuthProvider } from './AuthContext.tsx'

const site = { id: { type: 'ref', id: 's1', dis: 'Demo Office' }, dis: 'Demo Office', area: { type: 'number', val: 50000, unit: 'ft²' } }

function renderApp() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/site-organization']}>
        <AuthProvider><App /></AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function signInAs(user: string, pw: string) {
  await userEvent.type(await screen.findByLabelText('Username'), user)
  await userEvent.type(screen.getByLabelText('Password'), pw)
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.client.isLoggedIn = false
  mocks.client.about.mockResolvedValue({ whoami: 'su', productName: 'Haxall' })
  mocks.client.read.mockImplementation(async (f: string) => (f === 'site' ? [site] : []))
})

describe('sign in', () => {
  it('shows the login page when there is no session', async () => {
    renderApp()
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('wrong password -> clear error, stays on login', async () => {
    mocks.client.login.mockRejectedValue(new AuthError('x'))
    renderApp()
    await signInAs('su', 'nope')
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong username or password')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('Haxall down -> unreachable message', async () => {
    mocks.client.login.mockRejectedValue(new UnreachableError())
    renderApp()
    await signInAs('su', 'pw')
    expect(await screen.findByRole('alert')).toHaveTextContent('Haxall is unreachable')
  })

  it('success -> shell with app switcher and the site selector', async () => {
    mocks.client.login.mockResolvedValue(undefined)
    renderApp()
    await signInAs('su', 'pw')
    expect(await screen.findByRole('link', { name: 'Site Organization' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Trend Viewer' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Site')).toHaveValue('s1'))
    expect(mocks.client.login).toHaveBeenCalledWith('su', 'pw')
  })

  it('resumes a stored session on load', async () => {
    mocks.client.isLoggedIn = true
    renderApp()
    expect(await screen.findByRole('link', { name: 'Site Organization' })).toBeInTheDocument()
  })

  it('a stored session that Haxall rejects falls back to login without an error message', async () => {
    mocks.client.isLoggedIn = true
    mocks.client.about.mockRejectedValue(new AuthError())
    renderApp()
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('shell states', () => {
  it('no sites -> helpful empty state', async () => {
    mocks.client.isLoggedIn = true
    mocks.client.read.mockResolvedValue([])
    renderApp()
    expect(await screen.findByText('No sites found')).toBeInTheDocument()
    expect(screen.getByText(/make load/)).toBeInTheDocument()
  })

  it('failed site load -> error banner with retry', async () => {
    mocks.client.isLoggedIn = true
    mocks.client.read.mockRejectedValue(new UnreachableError())
    renderApp()
    expect(await screen.findByText('Haxall is unreachable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('sign out returns to login', async () => {
    mocks.client.isLoggedIn = true
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(mocks.client.logout).toHaveBeenCalled()
  })
})
