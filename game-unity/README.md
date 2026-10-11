# SandGlitch — Unity / Meta Quest

Prawdziwa gra VR na **Meta Quest** zbudowana w **Unity**. Nie ma tu żadnego trybu PC,
myszy ani klawiatury — cała rozgrywka dzieje się w sesji immersyjnej XR i jest sterowana
wyłącznie kontrolerami Questa.

> Folder `../game/` zawiera wcześniejszy prototyp WebXR (przeglądarkowy). Docelowym
> produktem dla Meta Quest jest właśnie ten projekt Unity.

## Co jest w grze

- **Intro / logo** — animowany hologram `IntroHologram`.
- **Menu startowe w VR** — prawdziwy panel 3D (`VRSpatialMenu`). Start tylko przez
  wycelowanie kontrolerem w przycisk i pociągnięcie triggera.
- **Fizyka** — chwytnie i rzucanie obiektów (`PhysicsBody` + `XRHandController`).
- **Niszczalne obiekty** — rozpadają się na kawałki (`DestructibleObject`).
- **NPC z ragdollem** — manekiny przyjmują obrażenia i przechodzą w ragdoll (`RagdollDummy`).
- **Stylizowana krew** — particle bursty przy trafieniach (`BloodBurst`).
- **Fale przeciwników** (`WaveManager`), **HUD w przestrzeni** (`WorldSpaceHud`),
  **lokomocja thumbstickiem** (`ThumbstickLocomotion`).

## Sterowanie (VR-only)

| Akcja | Kontroler |
| --- | --- |
| Start gry | wyceluj w przycisk menu + trigger |
| Poruszanie | lewy thumbstick (smooth) |
| Obrót (snap turn) | prawy thumbstick |
| Chwyt / rzut | trigger na obiekcie |
| Uderzenie | trigger w pustą przestrzeń / NPC |

## Struktura projektu

```
game-unity/
├─ Packages/manifest.json          # zależności Unity + pakietów Meta XR
└─ Assets/Scripts/
   ├─ GameConfig.cs                # ScriptableObject ze strojeniem
   ├─ GameManager.cs               # maszyna stanów + dane rozgrywki
   ├─ Feed.cs                      # kanał komunikatów (event feed)
   ├─ VRSpatialMenu.cs             # menu startowe w przestrzeni VR
   ├─ Interaction/XRHandController.cs    # grab/throw/punch per ręka
   ├─ Interaction/ThumbstickLocomotion.cs# ruch + snap turn
   ├─ Physics/PhysicsBody.cs       # baza dla chwytnych obiektów
   ├─ Physics/DestructibleObject.cs# rozpad na kawałki
   ├─ NPC/RagdollDummy.cs          # manekin z ragdollem + obrażenia
   ├─ Effects/BloodBurst.cs        # stylizowana krew
   ├─ Effects/ScreenShake.cs       # trauma shake dla uderzeń
   ├─ World/WaveManager.cs         # fale przeciwników
   ├─ World/WorldSpaceHud.cs       # billboard HUD (fala/score/HP/feed)
   └─ World/IntroHologram.cs       # logo/hologram
```

## Jak uruchomić

Przeczytaj **[SETUP_GUIDE.md](SETUP_GUIDE.md)** — zawiera krok po kroku: instalację
Unity + modułu Android, dodanie pakietów Meta OpenXR, złożenie sceny, przypisanie
skryptów do obiektów oraz build i wgranie APK na Meta Quest.

> Uwaga: sceny (`.unity`), prefabów i ustawień projektu nie da się pewnie wygenerować
> poza edytorem Unity, dlatego przewodnik opisuje ich złożenie ręczne — wszystkie
> potrzebne komponenty i zależności są już w kodzie.
