using System.Collections.Generic;
using UnityEngine;
using UnityEngine.XR;

namespace SandGlitch
{
    /// <summary>
    /// Attach to the XR Origin root. Left thumbstick = smooth locomotion (relative to
    /// head yaw), right thumbstick = snap turn. This is the only movement input.
    /// </summary>
    public class ThumbstickLocomotion : MonoBehaviour
    {
        [Header("Tuning")]
        public float moveSpeed = 2.5f;
        public float snapTurnDegrees = 45f;
        public float deadzone = 0.2f;
        public float snapCooldown = 0.3f;

        [Tooltip("The VR camera (Main Camera under Camera Offset).")]
        public Transform headTransform;

        float snapTimer;
        readonly List<InputDevice> leftDevices = new List<InputDevice>();
        readonly List<InputDevice> rightDevices = new List<InputDevice>();

        void Update()
        {
            if (!GameManager.Instance || !GameManager.Instance.IsPlaying) return;

            InputDevices.GetDevicesWithCharacteristics(
                InputDeviceCharacteristics.Controller | InputDeviceCharacteristics.Left, leftDevices);
            InputDevices.GetDevicesWithCharacteristics(
                InputDeviceCharacteristics.Controller | InputDeviceCharacteristics.Right, rightDevices);

            // Smooth locomotion.
            if (leftDevices.Count > 0 && leftDevices[0].TryGetFeatureValue(CommonUsages.primary2DAxis, out Vector2 stick))
            {
                if (stick.magnitude > deadzone && headTransform)
                {
                    Vector3 fwd = headTransform.forward; fwd.y = 0f; fwd.Normalize();
                    Vector3 right = headTransform.right; right.y = 0f; right.Normalize();
                    transform.position += (fwd * stick.y + right * stick.x) * moveSpeed * Time.deltaTime;
                }
            }

            // Snap turn.
            snapTimer -= Time.deltaTime;
            if (rightDevices.Count > 0 && rightDevices[0].TryGetFeatureValue(CommonUsages.primary2DAxis, out Vector2 rightStick))
            {
                if (snapTimer <= 0f && Mathf.Abs(rightStick.x) > 0.7f)
                {
                    transform.Rotate(0f, Mathf.Sign(rightStick.x) * snapTurnDegrees, 0f);
                    snapTimer = snapCooldown;
                }
            }
        }
    }
}
