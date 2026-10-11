using UnityEngine;

namespace SandGlitch
{
    /// <summary>
    /// A target NPC. On hit it takes damage, switches to ragdoll, and spawns stylized
    /// blood bursts. Ragdoll = rigidbody bones with colliders; standing pose uses the
    /// Animator (optional) plus one standing collider for interactions.
    /// </summary>
    public class RagdollDummy : MonoBehaviour
    {
        [Header("Health")]
        public float health = 60f;

        [Header("Ragdoll")]
        [Tooltip("Optional Animator for the standing idle pose.")]
        public Animator animator;
        [Tooltip("All ragdoll rigidbodies (hips, torso, head, limbs).")]
        public Rigidbody[] ragdollBones;
        [Tooltip("All ragdoll colliders.")]
        public Collider[] ragdollColliders;
        [Tooltip("Single collider used while standing (for grabs/punches).")]
        public Collider standingCollider;

        [Header("Effects")]
        public Transform bloodAnchor;
        public GameObject bloodBurstPrefab;

        bool ragdolled;
        bool dead;

        void Awake()
        {
            SetRagdoll(false);
        }

        public void TakeHit(Vector3 impulse, Vector3 point)
        {
            if (dead) return;

            health -= impulse.magnitude * 3f;
            SpawnBlood(point != Vector3.zero ? point : transform.position + Vector3.up);

            if (!ragdolled) EnterRagdoll(impulse);
            if (health <= 0f) Die();

            if (GameManager.Instance) GameManager.Instance.AddScore(10f);
        }

        void EnterRagdoll(Vector3 impulse)
        {
            ragdolled = true;
            if (animator) animator.enabled = false;
            if (standingCollider) standingCollider.enabled = false;
            SetRagdoll(true);

            foreach (var bone in ragdollBones)
                if (bone) bone.AddForce(impulse * Random.Range(0.7f, 1.3f), ForceMode.Impulse);

            Feed.Log("NPC // RAGDOLL");
        }

        void SetRagdoll(bool on)
        {
            foreach (var bone in ragdollBones) if (bone) bone.isKinematic = !on;
            foreach (var col in ragdollColliders) if (col) col.enabled = on;
        }

        void SpawnBlood(Vector3 point)
        {
            if (!bloodBurstPrefab) return;
            Vector3 at = bloodAnchor ? bloodAnchor.position : point;
            GameObject burst = Instantiate(bloodBurstPrefab, at, Quaternion.identity);
            Destroy(burst, 3f);
        }

        void Die()
        {
            if (dead) return;
            dead = true;
            if (GameManager.Instance)
            {
                GameManager.Instance.AddScore(50f);
                if (GameManager.Instance.waveManager)
                    GameManager.Instance.waveManager.ReportDummyDown();
            }
            Feed.Log("NPC // DOWN");
            Destroy(gameObject, 6f);
        }
    }
}
