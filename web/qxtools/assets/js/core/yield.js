/**
 * Szybkie oddanie wątku do pętli zdarzeń.
 * setTimeout(0) bywa opóźniany (throttling), MessageChannel nie.
 */

let channel = null;

function makeChannel() {
  if (typeof MessageChannel !== 'function') return null;
  try {
    return new MessageChannel();
  } catch {
    return null;
  }
}

/**
 * @returns {Promise<void>} rozwiązuje się w następnym makro-zadaniu
 */
const isNode = typeof process !== 'undefined' && Boolean(process.versions && process.versions.node);

export function yieldTask() {
  if (isNode) {
    // W testach Node otwarty MessagePort trzymałby pętlę zdarzeń przy życiu,
    // więc tam wystarczy setTimeout. W przeglądarce zawsze idziemy przez MessageChannel.
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return new Promise((resolve) => {
    if (!channel) channel = makeChannel();
    if (!channel) {
      setTimeout(resolve, 0);
      return;
    }
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });
}
