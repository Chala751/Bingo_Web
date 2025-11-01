import axios from "axios";

// Create base axios instance with sensible defaults
const API = axios.create({
  baseURL: "https://bingo-web-9lh2.onrender.com/api",
  // baseURL: "https://localhost:5000/api",
  withCredentials: true, // only if you actually use cookies
 
});

// Attach auth token automatically
API.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Helper: small sleep
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// Detect simple network availability in browser
API.isOnline = () => {
  try {
    return typeof navigator !== "undefined" ? navigator.onLine : true;
  } catch (e) {
    return true;
  }
};

// requestWithRetry: supports retries, exponential backoff, timeout and AbortSignal
// Usage: API.requestWithRetry({ method: 'get', url: '/games/..' }, { retries: 3, timeout: 8000, onRetry })
API.requestWithRetry = async (config, options = {}) => {
  const {
    retries = 3,
    backoff = 300, // base ms for exponential backoff
    timeout = API.defaults.timeout || 10000,
    onRetry = null,
    signal: userSignal = null,
  } = options;

  // If offline, fail fast with a clear error so UI can show offline state
  if (!API.isOnline()) {
    const err = new Error("Network appears to be offline");
    err.code = "ERR_OFFLINE";
    throw err;
  }

  let attempt = 0;

  // combine userSignal with internal timeout AbortController
  const attemptRequest = async () => {
    attempt++;
    // If user provided a signal and it's already aborted, throw
    if (userSignal && userSignal.aborted) {
      const err = new Error("Request canceled");
      err.name = "CanceledError";
      err.code = "ERR_CANCELED";
      throw err;
    }

    // Create controller for timeout; if userSignal aborts, we'll forward
    const timeoutController = new AbortController();
    const timers = [];
    // If a user signal exists, forward its abort to timeoutController
    if (userSignal) {
      const onAbort = () => timeoutController.abort();
      userSignal.addEventListener("abort", onAbort);
      timers.push(() => userSignal.removeEventListener("abort", onAbort));
    }

    // Setup timeout
    const to = setTimeout(() => timeoutController.abort(), timeout);
    timers.push(() => clearTimeout(to));

    // Merge provided config.signal with our timeout signal. Axios accepts `signal`.
    const reqConfig = {
      ...config,
      signal: timeoutController.signal,
    };

    try {
      const resp = await API.request(reqConfig);
      timers.forEach((fn) => fn());
      return resp;
    } catch (error) {
      timers.forEach((fn) => fn());

      // If aborted by signal, rethrow as canceled
      const msg = (error && error.message) || "";
      const isCanceled =
        error?.code === "ERR_CANCELED" ||
        error?.name === "CanceledError" ||
        (typeof msg === "string" && msg.toLowerCase().includes("cancel")) ||
        (typeof msg === "string" && msg.toLowerCase().includes("aborted"));
      if (isCanceled) throw error;

      // Decide whether to retry: network errors (no response) or 5xx or 429
      const status = error?.response?.status;
      const shouldRetry =
        (!error?.response && attempt <= retries) ||
        (status >= 500 && status < 600 && attempt <= retries) ||
        status === 429;

      if (!shouldRetry) {
        throw error;
      }

      // Optional hook to notify caller
      if (typeof onRetry === "function") {
        try {
          onRetry(attempt, error);
        } catch (e) {}
      }

      // Exponential backoff (jittered)
      const delay = Math.round(backoff * Math.pow(2, attempt - 1));
      const jitter = Math.round(Math.random() * 100);
      await sleep(delay + jitter);
      return attemptRequest();
    }
  };

  return attemptRequest();
};

export default API;
