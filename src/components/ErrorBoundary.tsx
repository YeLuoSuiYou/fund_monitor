import React from "react"

interface Props {
  children: React.ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 p-6 text-center text-zinc-100">
          <div className="mb-6 rounded-full bg-rose-500/10 p-4 text-rose-500">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h1 className="mb-2 text-xl font-bold">应用运行异常</h1>
          <p className="mb-8 text-sm text-zinc-400 max-w-md">
            很抱歉，程序在运行过程中遇到了不可恢复的错误。这可能是由于本地缓存配置冲突导致的。
          </p>
          <div className="flex gap-4">
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium hover:bg-zinc-700 transition-colors"
            >
              刷新页面
            </button>
            <button
              onClick={() => {
                localStorage.clear()
                window.location.href = "/"
              }}
              className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium hover:bg-rose-500 transition-colors"
            >
              重置并清空缓存
            </button>
          </div>
          {this.state.error && (
            <pre className="mt-12 max-w-full overflow-auto rounded-lg bg-zinc-900/50 p-4 text-left text-[10px] text-zinc-600 font-mono">
              {this.state.error.stack}
            </pre>
          )}
        </div>
      )
    }

    return this.props.children
  }
}
