import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode; fallback?: (error: Error) => ReactNode }
type State = { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error)
      return (
        <div className="mx-auto max-w-2xl rounded-xl border border-red-200 bg-red-50 p-6 mt-8">
          <p className="font-semibold text-red-800">Something went wrong rendering this page.</p>
          <pre className="mt-3 overflow-auto rounded bg-red-100 p-3 text-xs text-red-700">
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-4 rounded-md bg-red-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-800"
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
