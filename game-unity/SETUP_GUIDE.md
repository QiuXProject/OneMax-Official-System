# SandGlitch — przewodnik Unity → Meta Quest

Ten projekt zawiera cały kod rozgrywki. Sceny i prefaby składasz raz w edytorze Unity,
a potem budujesz APK na Questa. Poniżej pełna ścieżka.

---

## 1. Wymagania

- **Unity Hub** + Unity **2022.3 LTS** (lub 6000.x) z modułami:
  - `Android Build Support`
  - `OpenJDK`, `Android SDK & NDK Tools` (instaluje je Hub razem z modułem Android)
- **Meta Quest** z włączonym **Trybem dewelopera** (Developer Mode w aplikacji Meta).
- Kabel USB-C.

## 2. Otwarcie projektu

1. W Unity Hub kliknij **Open → Add project from disk** i wskaż folder `game-unity`.
2. Unity wczyta `Packages/manifest.json` i pobierze pakiety.

> Jeśli któraś wersja pakietu się nie rozwiąże, nie edytuj ręcznie — otwórz
> **Window → Package Manager** i zainstaluj z listy poniżej (Unity dobierze poprawne
> wersje dla Twojej wersji Unity):
>
> - `Input System`
> - `XR Plugin Management`
> - `OpenXR Plugin`
> - `XR Interaction Toolkit`
> - `Meta OpenXR` / `Meta XR SDK` (jeśli nie widać, dodaj rejestr Meta — patrz manifest)
> - `TextMeshPro`
> - `Universal RP`

## 3. Konfiguracja XR / Meta Quest

1. **Edit → Project Settings → XR Plug-in Management**:
   - Zakładka **Android** (ikona robota): zaznacz **OpenXR**.
   - W sekcji OpenXR dodaj profil **Meta Quest** i włącz feature groupy
     (np. Meta Quest Support, Meta XR SDK).
2. **Edit → Project Settings → Player → Android**:
   - `Scripting Backend` = **IL2CPP**
   - `Target Architectures` = **ARM64**
   - Ustaw `Package Name` (np. `com.onemax.sandglitch`).
3. **File → Build Settings → Switch Platform → Android**.

## 4. Złożenie sceny (raz)

Utwórz scenę `Assets/Scenes/SandGlitch.unity`.

### 4a. Gracz (XR Origin)
1. `GameObject → XR → Origin (Action-based)` — powstanie **XR Origin** z Camera Offset,
   Main Camera, Left/Right Controller.
   *(Jeśli wolisz prostsze podejście bez XR Interaction Toolkit, użyj pustych obiektów
   z `TrackedPoseDriver` — skrypty korzystają ze stabilnego API `InputDevices`.)*
2. Na **XR Origin (root)** dodaj komponent `ThumbstickLocomotion`; w polu
   `Head Transform` przypisz **Main Camera**.
3. Na **Main Camera** dodaj `ScreenShake`.
4. Na obiekty **Left Controller** i **Right Controller** dodaj po jednym
   `XRHandController` (ustaw `Hand` odpowiednio: Left / Right).

### 4b. Arena
1. Płaszczyzna/podłoga + ściany (statyczne kolajdery).
2. Obiekty do chwytania: sześciany/beczki z `Rigidbody` + `PhysicsBody`
   (ustaw `grabbable`). Część oznacz `destructible` i dodaj `DestructibleObject`
   z przypiętymi prefabami kawałków (`chunkPrefabs`).

### 4c. NPC (manekin z ragdollem)
1. `GameObject → 3D Object → Ragdoll…` — stwórz prefab manekina (rigidbody + collidery kości).
2. Utwórz prefab `Dummy` zawierający:
   - `RagdollDummy` (skrypt),
   - `standingCollider` (np. CapsuleCollider obejmujący sylwetkę),
   - wypełnione tablice `ragdollBones` / `ragdollColliders`,
   - opcjonalny `bloodAnchor` i prefab krwi.
3. Prefab krwi: Particle System + skrypt `BloodBurst` (zapisz jako `BloodBurst.prefab`).

### 4d. Menu startowe
1. Utwórz panel (Quad lub Canvas World Space) z napisem „SANDGLITCH” i przyciskiem.
2. Na przycisku daj `BoxCollider` + `MeshRenderer`.
3. Na root panelu dodaj `VRSpatialMenu`; przypisz `startButtonCollider` i
   `startButtonRenderer`. Menu samo ustawi się przed graczem i uruchomi grę triggerem.

### 4e. HUD + intro
1. Canvas **World Space** z polami TMP (wave/score/health/feed) i prostokątem paska
   zdrowia → dodaj `WorldSpaceHud` i przypisz pola.
2. Logo: dwa torusy + tekst → dodaj `IntroHologram`, przypisz `ring` i `ring2`.

### 4f. Menadżery
1. Pusty obiekt `GameManager`:
   - komponent `GameManager`,
   - utwórz `GameConfig` (Assets → Create → SandGlitch → Game Config) i przypisz,
   - przypisz `playerRig`, `hud`, `spatialMenu`.
2. Pusty obiekt `WaveManager`:
   - komponent `WaveManager`,
   - przypisz `dummyPrefab` i kilka `spawnPoints` wokół areny,
   - podlinkuj go w `GameManager.waveManager`.

### 4g. Warstwy (Layer)
Utwórz warstwę `Interactable` i przypisz ją obiektom chwytnym/NPC. W
`XRHandController.interactableMask` ustaw tę warstwę, żeby raycast nie trafiał w podłogę.

## 5. Build na Meta Quest

1. Włącz **Developer Mode** na Queście (aplikacja Meta → Urządzenia → Developer Mode).
2. Podłącz Questa kablem USB, zaakceptuj dostęp ADB na headsetcie.
3. **File → Build Settings → Android → Build And Run**.
4. Załóż headset — zobaczysz intro/logo i menu startowe. Wyceluj kontrolerem w
   **START** i pociągnij trigger, żeby wejść do sandboxa.

## 6. Sterowanie w grze

- Lewy thumbstick — płynne poruszanie.
- Prawy thumbstick — snap turn.
- Trigger na obiekcie — chwyt; puszczenie — rzut z impetem kontrolera.
- Trigger w pustą przestrzeń/NPC — uderzenie (impuls + krew + ragdoll).

---

### Troubleshooting

- **„No XR device” / czarny ekran na PC**: ten build jest tylko pod Questa; testuj na
  headsetcie (lub przez Meta Quest Link), nie w edytorowym Play Mode bez XR.
- **Pakiety Meta niewidoczne**: dodaj scoped registry Meta z `manifest.json` albo
  zainstaluj `Meta XR SDK` przez Package Manager.
- **Obiekty nie chwytają**: sprawdź warstwę `Interactable` i `interactableMask`,
  oraz że obiekt ma `Rigidbody` + `PhysicsBody`.
