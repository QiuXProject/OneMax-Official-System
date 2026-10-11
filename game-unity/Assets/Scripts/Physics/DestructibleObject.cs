using UnityEngine;

namespace SandGlitch
{
    /// <summary>
    /// Attach alongside PhysicsBody to make a prop shatter into chunks when its health
    /// runs out. Assign chunk prefabs (small rigidbody pieces) and an optional particle.
    /// </summary>
    [RequireComponent(typeof(PhysicsBody))]
    public class DestructibleObject : MonoBehaviour
    {
        [Header("Break Behaviour")]
        public GameObject[] chunkPrefabs;
        public int chunkCount = 4;
        public float chunkForce = 4f;
        public GameObject breakParticlePrefab;

        PhysicsBody body;
        bool broken;

        void Awake()
        {
            body = GetComponent<PhysicsBody>();
        }

        public void Damage(float amount, Vector3 point)
        {
            if (broken) return;
            if (body) body.Damage(amount);
            else Break();
        }

        public void Break()
        {
            if (broken) return;
            broken = true;

            Vector3 origin = transform.position;

            if (breakParticlePrefab)
                Instantiate(breakParticlePrefab, origin, Random.rotation);

            if (chunkPrefabs != null && chunkPrefabs.Length > 0)
            {
                for (int i = 0; i < chunkCount; i++)
                {
                    GameObject prefab = chunkPrefabs[i % chunkPrefabs.Length];
                    GameObject chunk = Instantiate(prefab, origin + Random.insideUnitSphere * 0.15f, Random.rotation);
                    var rb = chunk.GetComponent<Rigidbody>();
                    if (rb) rb.AddExplosionForce(chunkForce, origin, 3f);
                    Destroy(chunk, 8f);
                }
            }

            if (GameManager.Instance) GameManager.Instance.AddScore(25f);
            Feed.Log("BREAK // " + name);
            Destroy(gameObject);
        }
    }
}
