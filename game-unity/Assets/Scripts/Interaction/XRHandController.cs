using System.Collections.Generic;
using UnityEngine;
using UnityEngine.XR;

namespace SandGlitch
{
    /// <summary>
    /// Attach to a controller GameObject inside the XR Origin. Handles trigger-based
    /// grab / throw and punching using the stable InputDevices API (no version-specific
    /// XR Interaction Toolkit coupling, so it keeps working across Unity upgrades).
    /// </summary>
    public class XRHandController : MonoBehaviour
    {
        public enum Hand { Left, Right }
        public Hand hand = Hand.Right;

        [Header("Tuning")]
        public float grabRange = 1.2f;
        public float punchRange = 1.4f;
        public float punchForce = 6.5f;
        public float throwMultiplier = 1.15f;
        public LayerMask interactableMask = ~0;

        InputDevice device;
        bool deviceFound;
        bool triggerHeld;
        PhysicsBody heldBody;
        static readonly Vector3 AttachLocalOffset = new Vector3(0f, 0f, 0.12f);

        void Update()
        {
            if (!EnsureDevice()) return;
            if (!GameManager.Instance || !GameManager.Instance.IsPlaying) return;

            device.TryGetFeatureValue(CommonUsages.trigger, out float triggerValue);
            bool pressed = triggerValue > 0.6f;

            if (pressed && !triggerHeld) OnTriggerPressed();
            if (!pressed && triggerHeld) OnTriggerReleased();
            triggerHeld = pressed;

            if (heldBody) FollowHand();
        }

        bool EnsureDevice()
        {
            if (deviceFound && device.isValid) return true;
            InputDeviceCharacteristics side = hand == Hand.Left
                ? InputDeviceCharacteristics.Left
                : InputDeviceCharacteristics.Right;
            var list = new List<InputDevice>();
            InputDevices.GetDevicesWithCharacteristics(InputDeviceCharacteristics.Controller | side, list);
            if (list.Count > 0) { device = list[0]; deviceFound = device.isValid; }
            return deviceFound;
        }

        void OnTriggerPressed()
        {
            PhysicsBody grabbable = FindGrabbable();
            if (grabbable != null) { Grab(grabbable); return; }
            Punch();
        }

        void OnTriggerReleased()
        {
            if (heldBody) Throw();
        }

        PhysicsBody FindGrabbable()
        {
            if (Physics.SphereCast(transform.position, 0.06f, transform.forward, out RaycastHit hit, grabRange, interactableMask))
            {
                var body = hit.collider.GetComponentInParent<PhysicsBody>();
                if (body != null && body.IsGrabbable) return body;
            }
            return null;
        }

        void Grab(PhysicsBody body)
        {
            heldBody = body;
            body.BeginGrab();
            Feed.Log("GRAB // " + body.name);
        }

        void FollowHand()
        {
            heldBody.FollowPoint(transform.position + transform.TransformDirection(AttachLocalOffset), transform.rotation);
        }

        void Throw()
        {
            var releasing = heldBody;
            heldBody = null;
            device.TryGetFeatureValue(CommonUsages.deviceVelocity, out Vector3 velocity);
            device.TryGetFeatureValue(CommonUsages.deviceAngularVelocity, out Vector3 angularVelocity);
            releasing.EndGrab(velocity * throwMultiplier, angularVelocity);
            Feed.Log("THROW // " + releasing.name);
        }

        void Punch()
        {
            if (!Physics.SphereCast(transform.position, 0.08f, transform.forward, out RaycastHit hit, punchRange, interactableMask))
                return;

            var dummy = hit.collider.GetComponentInParent<RagdollDummy>();
            if (dummy != null)
            {
                dummy.TakeHit(transform.forward * punchForce, hit.point);
                return;
            }

            var destructible = hit.collider.GetComponentInParent<DestructibleObject>();
            var rigid = hit.collider.attachedRigidbody;
            if (rigid != null && !rigid.isKinematic)
                rigid.AddForceAtPosition(transform.forward * (punchForce * 8f), hit.point, ForceMode.Impulse);

            if (destructible != null) destructible.Damage(15f, hit.point);
            if (ScreenShake.Instance) ScreenShake.Instance.AddTrauma(0.35f);
        }

        void OnDisable()
        {
            if (heldBody) { heldBody.EndGrab(Vector3.zero, Vector3.zero); heldBody = null; }
        }
    }
}
