using UnityEngine;

namespace SandGlitch
{
    /// <summary>
    /// Game state machine and shared gameplay data. The game only ever runs while an
    /// immersive XR session is active; there is no desktop gameplay path.
    /// </summary>
    public class GameManager : MonoBehaviour
    {
        public enum GameState { Intro, Menu, Playing }

        public static GameManager Instance { get; private set; }

        [Header("References")]
        public GameConfig config;
        public Transform playerRig;      // the XR Origin / Camera Offset root
        public WorldSpaceHud hud;
        public WaveManager waveManager;
        public VRSpatialMenu spatialMenu;

        public GameState State { get; private set; } = GameState.Intro;
        public int Wave { get; private set; } = 1;
        public float Score { get; private set; }
        public float Health { get; private set; } = 100f;

        public bool IsPlaying => State == GameState.Playing;

        void Awake()
        {
            if (Instance != null && Instance != this) { Destroy(gameObject); return; }
            Instance = this;
        }

        void Start()
        {
            Health = config ? config.maxHealth : 100f;
            EnterMenu();
        }

        public void EnterMenu()
        {
            State = GameState.Menu;
            if (spatialMenu) spatialMenu.gameObject.SetActive(true);
            if (hud) hud.Refresh();
        }

        /// <summary>Only the in-world menu button (via controller trigger) calls this.</summary>
        public void StartGame()
        {
            if (State == GameState.Playing) return;
            State = GameState.Playing;
            Health = config ? config.maxHealth : 100f;
            Wave = 1;
            Score = 0f;

            if (spatialMenu) spatialMenu.gameObject.SetActive(false);
            if (waveManager) waveManager.StartFirstWave();
            if (hud) hud.Refresh();

            Feed.Log("SYSTEM // SANDBOX ONLINE");
            Feed.Log("MISSION // BREAK THE ROOM");
        }

        public void AddScore(float amount)
        {
            Score += amount;
            if (hud) hud.Refresh();
        }

        public void DamagePlayer(float amount)
        {
            Health = Mathf.Max(0f, Health - amount);
            if (hud) hud.Refresh();
            if (Health <= 0f) ResetPlayer();
        }

        public void ResetPlayer()
        {
            Health = config ? config.maxHealth : 100f;
            if (playerRig) playerRig.position = Vector3.zero;
            Feed.Log("SUIT // EMERGENCY RESET");
            if (hud) hud.Refresh();
        }

        public void OnWaveCleared()
        {
            Wave += 1;
            AddScore(100f);
        }
    }
}
