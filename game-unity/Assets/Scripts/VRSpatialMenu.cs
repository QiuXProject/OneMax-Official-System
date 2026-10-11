using System.Collections.Generic;
using UnityEngine;
using UnityEngine.XR;

namespace SandGlitch
{
    /// <summary>
    /// A real in-world start menu. The only way into the game is to aim a controller
    /// ray at the start button and pull the trigger. There is no mouse/keyboard path.
    /// Attach this to the menu panel root; assign the button collider/renderer.
    /// </summary>
    public class VRSpatialMenu : MonoBehaviour
    {
        [Header("References")]
        public Collider startButtonCollider;
        public MeshRenderer startButtonRenderer;

        [Header("Placement")]
        [Tooltip("Distance in front of the player when the menu appears.")]
        public float distance = 1.6f;

        [Header("Styling")]
        public Color idleColor = new Color(1.00f, 0.45f, 0.23f);
        public Color hoverColor = new Color(0.84f, 1.00f, 0.33f);

        MaterialPropertyBlock block;
        bool wasHovering;
        readonly List<InputDevice> controllers = new List<InputDevice>();

        void Awake()
        {
            block = new MaterialPropertyBlock();
        }

        void OnEnable()
        {
            PlaceInFrontOfPlayer();
            SetHover(false);
        }

        public void PlaceInFrontOfPlayer()
        {
            var cam = Camera.main;
            if (!cam) return;
            Vector3 fwd = cam.transform.forward;
            fwd.y = 0f;
            if (fwd.sqrMagnitude < 0.001f) fwd = Vector3.forward;
            fwd.Normalize();
            transform.position = cam.transform.position + fwd * distance;
            // Face the panel back toward the player so it reads correctly.
            transform.rotation = Quaternion.LookRotation(-fwd, Vector3.up);
        }

        void Update()
        {
            if (GameManager.Instance && GameManager.Instance.State != GameManager.GameState.Menu) return;
            PollControllers();
        }

        void PollControllers()
        {
            bool hover = false;
            bool triggered = false;

            InputDevices.GetDevicesWithCharacteristics(InputDeviceCharacteristics.Controller, controllers);
            foreach (var device in controllers)
            {
                if (!device.isValid) continue;
                if (!device.TryGetFeatureValue(CommonUsages.devicePosition, out Vector3 pos)) continue;
                device.TryGetFeatureValue(CommonUsages.deviceRotation, out Quaternion rot);

                Ray ray = new Ray(pos, rot * Vector3.forward);
                if (Physics.Raycast(ray, out RaycastHit hit, 6f))
                {
                    if (startButtonCollider && hit.collider == startButtonCollider)
                    {
                        hover = true;
                        if (device.TryGetFeatureValue(CommonUsages.trigger, out float triggerValue) && triggerValue > 0.6f)
                            triggered = true;
                    }
                }
            }

            SetHover(hover);
            if (triggered && GameManager.Instance) GameManager.Instance.StartGame();
        }

        void SetHover(bool hover)
        {
            if (hover == wasHovering) return;
            wasHovering = hover;
            if (!startButtonRenderer) return;
            startButtonRenderer.GetPropertyBlock(block);
            block.SetColor("_BaseColor", hover ? hoverColor : idleColor);
            block.SetColor("_Color", hover ? hoverColor : idleColor);
            startButtonRenderer.SetPropertyBlock(block);
        }
    }
}
