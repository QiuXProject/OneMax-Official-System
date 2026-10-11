using UnityEngine;

namespace SandGlitch
{
    /// <summary>
    /// Animated SandGlitch logo shown in-world before/behind the start menu.
    /// Assign two torus/ring transforms to get the spinning hologram rings.
    /// </summary>
    public class IntroHologram : MonoBehaviour
    {
        [Tooltip("Outer hologram ring.")]
        public Transform ring;
        [Tooltip("Inner hologram ring.")]
        public Transform ring2;

        public float spinSpeed = 20f;

        void Update()
        {
            if (ring) ring.Rotate(0f, 0f, spinSpeed * Time.deltaTime, Space.Self);
            if (ring2) ring2.Rotate(0f, 0f, -spinSpeed * 0.6f * Time.deltaTime, Space.Self);
        }
    }
}
