// One registration interface for the existing providers and both renderers.
// This does not fetch or invent a fallback: an explicit protocol registration
// remains the only authority for reading a non-HTTP tile URL.
export function createSharedTileProtocols({forward} = {}) {
  const handlers = new Map();
  const addProtocol = (scheme, handler) => {
    if (typeof scheme !== 'string' || !/^[a-z][a-z0-9+.-]*$/.test(scheme) ||
        scheme === 'http' || scheme === 'https' || typeof handler !== 'function') {
      throw new TypeError('Invalid application tile protocol');
    }
    // Forward before storing so a failed registration cannot leave the
    // pipelines disagreeing. Re-registering replaces the same exact scheme.
    forward?.(scheme, handler);
    handlers.set(scheme, handler);
  };
  const read = async (params, controller) => {
    const scheme = /^([a-z][a-z0-9+.-]*):\/\//.exec(params?.url)?.[1];
    const handler = handlers.get(scheme);
    if (!handler) throw new Error('Tile protocol not registered');
    controller.signal.throwIfAborted();
    return handler(params, controller);
  };
  return {addProtocol, read};
}
