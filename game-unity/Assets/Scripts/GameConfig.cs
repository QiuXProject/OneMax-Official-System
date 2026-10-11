using UnityEngine;

namespace SandGlitch
{
    /// <summary>
    /// Central tunables for SandGlitch. Create one via
    /// Assets > Create > SandGlitch > Game Config and assign it to the GameManager.
    /// </summary>
    [CreateAssetMenu(fileName = "GameConfig", menuName = "SandGlitch/Game Config")]
    public class GameConfig : ScriptableObject
    {
        [Header("Player")]
        public float moveSpeed = 2.5f;
        public float snapTurnDegrees = 45f;
        public float maxHealth = 100f;

        [Header("Interaction")]
        public float grabRange = 1.2f;
        public float punchRange = 1.4f;
        public float punchForce = 6.5f;
        public float throwMultiplier = 1.15f;

        [Header("Waves")]
        public int dummiesPerWave = 3;
        public float waveResetDelay = 3.2f;
        public float dummyHealth = 60f;

        [Header("Destruction")]
        public float destructibleHealth = 40f;
        public int chunkCount = 4;
        public float chunkForce = 4f;

        [Header("Palette")]
        public Color acidColor = new Color(0.84f, 1.00f, 0.33f);
        public Color bloodColor = new Color(0.72f, 0.06f, 0.09f);
        public Color orangeColor = new Color(1.00f, 0.45f, 0.23f);
        public Color cyanColor = new Color(0.31f, 0.85f, 0.80f);
    }
}
