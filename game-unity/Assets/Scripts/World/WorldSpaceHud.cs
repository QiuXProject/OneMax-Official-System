using System.Collections.Generic;
using TMPro;
using UnityEngine;

namespace SandGlitch
{
    /// <summary>
    /// A billboarded world-space HUD (wave, score, suit integrity, event feed).
    /// Build it as a Canvas set to World Space with TextMeshPro text fields, parent it
    /// into the scene, and assign the references here.
    /// </summary>
    public class WorldSpaceHud : MonoBehaviour
    {
        [Header("Text Fields")]
        public TMP_Text waveText;
        public TMP_Text scoreText;
        public TMP_Text healthText;
        public TMP_Text feedText;

        [Tooltip("Rect that scales horizontally to show suit integrity 0..1.")]
        public RectTransform healthBar;

        readonly List<string> feedLines = new List<string>();
        Transform cam;

        void Start()
        {
            cam = Camera.main ? Camera.main.transform : null;
            Feed.OnLog += PushFeed;
            Refresh();
        }

        void OnDestroy()
        {
            Feed.OnLog -= PushFeed;
        }

        void PushFeed(string line)
        {
            feedLines.Add(line);
            if (feedLines.Count > 4) feedLines.RemoveAt(0);
            if (feedText) feedText.text = string.Join("\n", feedLines);
        }

        void LateUpdate()
        {
            if (cam) transform.rotation = Quaternion.LookRotation(transform.position - cam.position);
        }

        public void Refresh()
        {
            var gm = GameManager.Instance;
            if (!gm) return;
            if (waveText) waveText.text = $"WAVE {gm.Wave:00}";
            if (scoreText) scoreText.text = $"SCORE {Mathf.FloorToInt(gm.Score):000000}";
            if (healthText) healthText.text = $"SUIT {Mathf.RoundToInt(gm.Health):000}%";
            if (healthBar) healthBar.localScale = new Vector3(Mathf.Clamp01(gm.Health / 100f), 1f, 1f);
        }
    }
}
