import React from 'react';
import { COLORS, TYPOGRAPHY, BORDERS } from '../theme';
import Icon from '../Icons';

/**
 * ErrorBoundary - Catches errors in child components and displays fallback UI
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({
      error,
      errorInfo,
    });
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            background: COLORS.background.primary,
            padding: '40px 20px',
            fontFamily: TYPOGRAPHY.fontFamily.default,
          }}
        >
          <div
            style={{
              maxWidth: '600px',
              width: '100%',
              background: COLORS.background.secondary,
              borderRadius: BORDERS.radius.lg,
              padding: '32px',
              border: `1px solid ${COLORS.border.default}`,
            }}
          >
            {/* Error Icon */}
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background: COLORS.status.dangerBgDark,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 24px',
              }}
            >
              <Icon name="close" size={32} color={COLORS.status.dangerText} />
            </div>

            {/* Title */}
            <h1
              style={{
                margin: '0 0 12px 0',
                fontSize: TYPOGRAPHY.fontSize['3xl'],
                fontWeight: TYPOGRAPHY.fontWeight.semibold,
                color: COLORS.text.secondary,
                textAlign: 'center',
              }}
            >
              Oops! Something went wrong
            </h1>

            {/* Description */}
            <p
              style={{
                margin: '0 0 24px 0',
                fontSize: TYPOGRAPHY.fontSize.md,
                color: COLORS.text.muted,
                textAlign: 'center',
                lineHeight: TYPOGRAPHY.lineHeight.normal,
              }}
            >
              The application encountered an unexpected error. You can try reloading the
              page or returning to the home screen.
            </p>

            {/* Error Details (collapsible) */}
            {this.state.error && (
              <details
                style={{
                  marginBottom: '24px',
                  padding: '16px',
                  background: COLORS.background.dark,
                  borderRadius: BORDERS.radius.md,
                  border: `1px solid ${COLORS.border.default}`,
                }}
              >
                <summary
                  style={{
                    cursor: 'pointer',
                    fontSize: TYPOGRAPHY.fontSize.base,
                    color: COLORS.text.muted,
                    fontWeight: TYPOGRAPHY.fontWeight.medium,
                    marginBottom: '12px',
                    userSelect: 'none',
                  }}
                >
                  Error Details
                </summary>
                <pre
                  style={{
                    margin: '12px 0 0 0',
                    padding: '12px',
                    background: COLORS.background.primary,
                    borderRadius: BORDERS.radius.sm,
                    fontSize: TYPOGRAPHY.fontSize.sm,
                    color: COLORS.status.error,
                    overflow: 'auto',
                    maxHeight: '200px',
                    fontFamily: TYPOGRAPHY.fontFamily.mono,
                    whiteSpace: 'pre-wrap',
                    wordWrap: 'break-word',
                  }}
                >
                  {this.state.error.toString()}
                  {this.state.errorInfo && `\n\n${this.state.errorInfo.componentStack}`}
                </pre>
              </details>
            )}

            {/* Actions */}
            <div
              style={{
                display: 'flex',
                gap: '12px',
                justifyContent: 'center',
              }}
            >
              <button
                onClick={() => window.location.reload()}
                style={{
                  padding: '10px 20px',
                  background: COLORS.accent.primary,
                  color: COLORS.text.primary,
                  border: 'none',
                  borderRadius: BORDERS.radius.md,
                  fontSize: TYPOGRAPHY.fontSize.md,
                  fontWeight: TYPOGRAPHY.fontWeight.medium,
                  cursor: 'pointer',
                  fontFamily: TYPOGRAPHY.fontFamily.default,
                  transition: 'background 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = COLORS.accent.primaryHover;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = COLORS.accent.primary;
                }}
              >
                Reload Page
              </button>
              <button
                onClick={this.handleReset}
                style={{
                  padding: '10px 20px',
                  background: COLORS.background.elevated,
                  color: COLORS.text.tertiary,
                  border: `1px solid ${COLORS.border.default}`,
                  borderRadius: BORDERS.radius.md,
                  fontSize: TYPOGRAPHY.fontSize.md,
                  fontWeight: TYPOGRAPHY.fontWeight.medium,
                  cursor: 'pointer',
                  fontFamily: TYPOGRAPHY.fontFamily.default,
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = COLORS.border.light;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = COLORS.background.elevated;
                }}
              >
                Try Again
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
