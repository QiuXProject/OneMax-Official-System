using UnityEngine;

namespace SandGlitch
{
    /// <summary>
    /// Base component for any grabbable physics prop. Put this + a Rigidbody on crates,
    /// barrels, debris, etc. Pair with DestructibleObject to make it breakable.
    /// </summary>
    [RequireComponent(typeof(Rigidbody))]
    public class PhysicsBody : MonoBehaviour
    {
        [Header("Behaviour")]
        public bool grabbable = true;
        public bool destructible = false;
        public float health = 40f;

        Rigidbody rb;
        bool held;

        public bool IsGrabbable => grabbable && !held;
        public bool IsHeld => held;

        void Awake()
        {
            rb = GetComponent<Rigidbody>();
        }

        public void BeginGrab()
        {
            held = true;
            rb.isKinematic = true;
        }

        public void FollowPoint(Vector3 position, Quaternion rotation)
        {
            if (!held) return;
            rb.MovePosition(position);
            rb.MoveRotation(rotation);
        }

        public void EndGrab(Vector3 velocity, Vector3 angularVelocity)
        {
            held = false;
            rb.isKinematic = false;
            rb.velocity = velocity;
            rb.angularVelocity = angularVelocity;
        }

        public void Damage(float amount)
        {
            if (!destructible) return;
            health -= amount;
            if (health <= 0f)
            {
                var destructible = GetComponent<DestructibleObject>();
                if (destructible) destructible.Break();
                else Destroy(gameObject);
            }
        }
    }
}
