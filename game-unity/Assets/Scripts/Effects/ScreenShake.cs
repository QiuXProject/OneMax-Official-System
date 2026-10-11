using UnityEngine;

namespace SandGlitch
{
    /// <summary>
    /// Attach to the VR camera (Main Camera under Camera Offset). Applies trauma-based
    /// shake so punches and impacts feel weighty without breaking comfort.
    /// </summary>
    public class ScreenShake : MonoBehaviour
    {
        public static ScreenShake Instance { get; private set; }

        [Tooltip("Maximum local shake offset in metres. Keep small for VR comfort.")]
        public float maxOffset = 0.02f;

        float trauma;

        void Awake()
        {
            Instance = this;
        }

        public void AddTrauma(float amount)
        {
            trauma = Mathf.Clamp01(trauma + amount);
        }

        void LateUpdate()
        {
            if (trauma <= 0f) return;
            float shake = trauma * trauma * maxOffset;
            transform.localPosition += Random.insideUnitSphere * shake;
            trauma = Mathf.Max(0f, trauma - Time.deltaTime * 1.5f);
        }
    }
}
