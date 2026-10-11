using UnityEngine;

namespace SandGlitch
{
    /// <summary>
    /// Put this on a stylized blood particle prefab. It auto-plays and self-cleans, so
    /// RagdollDummy can just Instantiate() it at the impact point.
    /// </summary>
    public class BloodBurst : MonoBehaviour
    {
        [Tooltip("Lifetime before the burst object is destroyed.")]
        public float lifetime = 3f;

        void Awake()
        {
            var ps = GetComponentInChildren<ParticleSystem>();
            if (ps) ps.Play();
            Destroy(gameObject, lifetime);
        }
    }
}
