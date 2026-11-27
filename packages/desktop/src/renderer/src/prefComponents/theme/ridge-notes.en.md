# Ridge notes

## Field journal

The mist lifted just before sunrise. The ridge is **open**, the creek is *rising*, and the stones are ***especially slippery***. Follow the [route details](#route-details "Stops and elevations"). The ~~old route~~ is closed.

Save the notes to `ridge.md`. The trail report changed from [-dry-] to {+slippery+}. Look for the :compass: at the trailhead and ==keep to the marked path==.

Morning reading: 720 m\
Next reading: 08:30
Visibility is improving.

The paper map uses a literal \* to mark the water source.

> Visit the same ridge again in five minutes.
>
> > A second observation tells you more about the weather than a single reading.

---

### Walking plan

1. Start from Cedar pass.
2. Cross Lower creek and follow the marked path.
   1. Check the depth at the first marker.
   2. Look for the sign on the opposite bank.
      - Turn back if the sign is hidden by fog.
3. Turn back at the stone bridge.

- Carry enough water for the round trip.
- Pack a light rain layer.
  - Keep it near the top of the bag.
  - Put the map in a waterproof sleeve.

#### Before departure

- [x] Save the route.
- [x] Check the creek level.
- [ ] Record the return time.

##### Weather window

Visibility is best just after the fog lifts. The elevation readings are approximate.[^elevation]

###### Recording convention

Use metres for elevation and kilometres for distance. Hikes in this journal start at the same trailhead.

### Route details

| Stop | Elevation | Status |
| :--- | ---: | :---: |
| Cedar pass | 720 m | Open |
| Lower creek | 610 m | Slippery |
| Stone bridge | 645 m | Rest stop |

![Sketch of the route between the three stops](./ridge-map.png "Cedar pass to Stone bridge")

### Code and formulas

```js title="trail-time.js" {3,5}
// Measurements from the first stop.
const altitude = 720
const distance = 4.2

console.log(`Cedar pass: ${altitude} m`)
```

A plain-text reading from the weather log:

    08:10  visibility: 800 m
    08:30  visibility: 950 m

The rain gauge collected 12 L of H~2~O per 10 m^2^. For an average speed of $v = 3$ km/h and a route length of $d = 4.2$ km, the estimated walking time is

$$
t = \frac{d}{v} = \frac{4.2}{3} = 1.4\ \mathrm{h}
$$

Diagrams and reference material
-------------------------------

```mermaid
flowchart LR
    A[Cedar pass] --> B[Lower creek] --> C[Stone bridge]
```

### Trail conditions

<!-- tabs -->

#### | Clear weather

Follow the blue markers along the ridge.

#### | Low visibility

Stay below the tree line and turn back at the creek.

<!-- /tabs -->

### Trail alerts

> [!TIP]
> Stay on the gravel at the creek.

> [!NOTE]
> The distances in this journal start at Cedar pass.

> [!IMPORTANT]
> Leave the seasonal gate as you found it.

> [!WARNING]
> Cross the creek only while the stepping stones are visible.

> [!CAUTION]
> Keep clear of the bank below the stone bridge.

### Saving the journal

<p>Press <kbd>Ctrl</kbd> + <kbd>S</kbd> to save. The <abbr title="Global Positioning System">GPS</abbr> log belongs in the same folder.</p>

<details>
<summary>Backup copy</summary>
<p>Keep an offline copy of the journal before leaving.</p>
</details>

See the [Markdown specification][commonmark] or visit <https://commonmark.org/>.

[commonmark]: https://commonmark.org/ "CommonMark"
[^elevation]: Elevations come from the trail markers and are rounded to the nearest metre.
