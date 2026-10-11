using UnityEngine;

namespace SandGlitch
{
    /// <summary>
    /// Tiny event feed used for in-world status messages (the "event feed").
    /// WorldSpaceHud subscribes to render the latest lines.
    /// </summary>
    public static class Feed
    {
        public static event System.Action<string> OnLog;

        public static void Log(string message)
        {
            Debug.Log("[SandGlitch] " + message);
            OnLog?.Invoke(message);
        }
    }
}
