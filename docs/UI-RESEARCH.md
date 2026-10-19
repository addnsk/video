# UI research: DaVinci Resolve on desktop, mobile editors on phones

## Findings

### DaVinci Resolve (desktop)

- **Pages.** The interface is split into pages: Media, Cut, Edit, Fusion, Color, Fairlight and Deliver. You switch between them with tabs along the bottom of the window. Some panels, the Media Pool for example, keep the same place on most pages. [2Pop CalArts]
- **Edit page.**
  - The Media Pool sits top left, with a bin tree on its left side.
  - The Effects Library has the same structure: a category tree (transitions, titles, generators, filters) beside a browsing area.
  - The Inspector sits top right and edits the selected clip and its effects.
  - The source viewer and the timeline viewer sit between them. The timeline runs across the bottom.
  - Panel buttons in the top bar hide or show these panels, which lets the timeline take more room. [DR12 and DR14 manuals, Effects Library chapter of the DR18 manual]
- **Resolve 19.** Media Pool and timeline sizing was improved so the viewer can be as large as possible. [ProVideo Coalition]
- **Color page.**
  - A viewer with split-screen wipe, and a gallery of stills.
  - A node editor.
  - Color wheels: Lift, Gamma, Gain and Offset.
  - Scopes, opened from the lower right panel. [Stocksy support, Medium guide]
- **Resolve for iPad.** It has only the Cut and Color pages. There is no Fusion or Fairlight on the iPad. [Y.M.Cinema, TryUncle]

### Mobile editors

- **CapCut.**
  - Top to bottom: preview, then the timeline, then a bottom row of tool categories (Audio, Text, Effects, Filters and so on).
  - Clips on the timeline are bars you drag, trim at the ends or tap to edit.
  - Reviewers complain that the labels in the bottom bar are too small. [TechRadar, Skeepers]
- **VN** follows the same pattern as CapCut. [Splice]
- **LumaFusion on iPhone.**
  - In portrait, the viewer is on top, the timeline in the middle and the clip library at the bottom.
  - The bottom row changes with the task: library first, then transitions and effects.
  - A corner button switches between preset layouts, and each layout has its own portrait and landscape version. [Digital Camera World, TechRadar, RedShark]

## Decisions for Montage

1. **Desktop: page tabs at the bottom, as in Resolve.**

   | Page | Layout |
   |---|---|
   | Media | Media pool and source viewer |
   | Edit | Media pool or effects on the left; source and timeline viewers in the middle; inspector on the right; timeline at the bottom |
   | Fusion | Viewer and node editor; inspector on the right |
   | Color | Viewer and gallery on top; nodes in the middle; wheels and curves together with scopes at the bottom; clip strip |
   | Fairlight | Timeline with large tracks and the mixer on the right |
   | Deliver | Render settings on the left, viewer, render queue on the right |

   Panels are resizable splits. Their sizes are remembered per page, and the panel buttons in the top bar show or hide them.
2. **Phone portrait.**
   - Top to bottom: viewer, transport, timeline, a scrolling tool bar that changes with the selection, then the page switch (Edit, Color, Audio, Export).
   - Inspectors open as bottom sheets at half or full height.
   - Labels are at least 12 px; buttons are at least 44 px.
3. **Phone landscape.** The viewer is on the left and the tools sit in a side column; sheets open as a side panel.
4. **Look.**
   - A dark, flat theme: background levels from #1b1b1e to #2c2c31, thin seams between panels, an amber accent (the current #e8a33d).
   - 12 px text on desktop, 22–24 px rows; 14 px text and 44 px rows on touch screens.
   - A light theme is offered as an option.
5. **Breakpoints.**
   - Phone: under 600 px wide, or under 500 px tall.
   - Tablet: 600–1023 px wide; it gets the desktop layout with touch sizes.
   - Desktop: 1024 px and wider.

## Sources

- https://2pop.calarts.edu/technicalsupport/davinci-resolve-interface/
- https://ltbits.github.io/davinci-resolve-manuals/DR12/DR12-RM-13.pdf
- https://ltbits.github.io/davinci-resolve-manuals/DR14/DR14-RM-04.pdf
- https://www.steakunderwater.com/VFXPedia/__man/Resolve18-6/DaVinciResolve18_Manual_files/part30.htm
- https://www.provideocoalition.com/davinci-resolve-19-released/
- https://support.stocksy.com/hc/en-us/articles/4412279566740-DaVinci-Resolve-Color-Page-Overview
- https://ymcinema.com/2022/12/07/davinci-resolve-for-ipad-a-review-and-insights/
- https://www.techradar.com/pro/software-services/capcut-review
- https://spliceapp.com/blog/which-apps-replicate-capcuts-editing-interface
- https://digitalcameraworld.com/reviews/lumafusion-review-the-best-video-editing-app-for-iphone-and-ipad
- https://www.techradar.com/pro/software-services/lumafusion-review
