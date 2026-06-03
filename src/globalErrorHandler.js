// Top-level safety net for errors that escape the app's normal async handling.
// Without this, an uncaught exception or rejected promise fails silently in
// production. The wiring is a pure function over an EventTarget so it can be
// unit-tested without a browser.

export function installGlobalErrorHandlers(target, { onError }) {
  function handleError(event) {
    const message =
      (event && event.error && event.error.message) ||
      (event && event.message) ||
      'Unknown error';
    onError({ type: 'error', message, error: event && event.error });
  }

  function handleRejection(event) {
    const reason = event && event.reason;
    const message =
      (reason && reason.message) || String(reason === undefined ? 'Unhandled rejection' : reason);
    onError({ type: 'unhandledrejection', message, error: reason });
  }

  target.addEventListener('error', handleError);
  target.addEventListener('unhandledrejection', handleRejection);

  return function uninstall() {
    target.removeEventListener('error', handleError);
    target.removeEventListener('unhandledrejection', handleRejection);
  };
}
