using System.Collections;
using UnityEngine;

namespace SandGlitch
{
    /// <summary>
    /// Spawns waves of ragdoll dummies and advances the wave when all are down.
    /// Assign spawn points around the arena and a dummy prefab.
    /// </summary>
    public class WaveManager : MonoBehaviour
    {
        [Header("Spawning")]
        public RagdollDummy dummyPrefab;
        public Transform[] spawnPoints;
        public int dummiesPerWave = 3;
        public float waveResetDelay = 3.2f;

        int activeCount;
        bool waveInProgress;

        public void StartFirstWave()
        {
            StartCoroutine(SpawnRoutine());
        }

        IEnumerator SpawnRoutine()
        {
            yield return new WaitForSeconds(0.6f);
            SpawnWave();
        }

        public void SpawnWave()
        {
            if (!dummyPrefab || spawnPoints == null || spawnPoints.Length == 0)
            {
                Feed.Log("WAVE // NO SPAWN POINTS CONFIGURED");
                return;
            }

            activeCount = dummiesPerWave;
            for (int i = 0; i < dummiesPerWave; i++)
            {
                Transform sp = spawnPoints[i % spawnPoints.Length];
                var dummy = Instantiate(dummyPrefab, sp.position, sp.rotation);
                dummy.name = $"Dummy_{GameManager.Instance.Wave}_{i}";
            }
            waveInProgress = true;
            Feed.Log($"WAVE {GameManager.Instance.Wave:00} // DUMMIES DEPLOYED");
        }

        public void ReportDummyDown()
        {
            activeCount = Mathf.Max(0, activeCount - 1);
            if (activeCount == 0 && waveInProgress)
            {
                waveInProgress = false;
                Feed.Log("WAVE CLEAR // RESETTING TARGETS");
                if (GameManager.Instance) GameManager.Instance.OnWaveCleared();
                StartCoroutine(NextWaveRoutine());
            }
        }

        IEnumerator NextWaveRoutine()
        {
            yield return new WaitForSeconds(waveResetDelay);
            if (GameManager.Instance && GameManager.Instance.IsPlaying) SpawnWave();
        }
    }
}
