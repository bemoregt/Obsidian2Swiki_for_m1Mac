(function () {
  var statusEl = document.getElementById('graph-status');
  var panelEl = document.getElementById('graph-panel');
  var panelTitle = document.getElementById('panel-title');
  var panelMeta = document.getElementById('panel-meta');
  var panelOpen = document.getElementById('panel-open');
  var canvas = document.getElementById('graph-canvas');
  if (!canvas || typeof THREE === 'undefined') return;

  function setStatus(text) {
    statusEl.textContent = text;
    statusEl.style.display = text ? '' : 'none';
  }

  // --- Forward-facing cone tree layout --------------------------------------
  // The root sits at the tip, close to the viewer. Each node inherits an
  // angular slice from its parent (split among children in proportion to
  // subtree size, like a sunburst), but the cone is capped well under a full
  // circle so the tree fans out ahead of the camera instead of wrapping
  // all the way around it. Distance from the root grows with depth, so
  // ordinary camera perspective makes deeper nodes look both farther away
  // and smaller - reinforced by shrinking their actual size a little too.
  var CONE_ANGLE = Math.PI * 0.85;
  var MIN_ARC_PER_NODE = 3.6;

  function layoutTree(root, childrenOf) {
    var leafCount = {};
    function countLeaves(node) {
      if (leafCount[node] !== undefined) return leafCount[node];
      var kids = childrenOf[node] || [];
      var count = kids.length ? 0 : 1;
      for (var i = 0; i < kids.length; i++) count += countLeaves(kids[i]);
      leafCount[node] = count;
      return count;
    }
    countLeaves(root);

    // Pick a depth spacing generous enough that even the widest single
    // fan-out (the node with the most direct children) gets enough arc
    // length per child to avoid overlapping boxes.
    var maxChildren = 1;
    Object.keys(childrenOf).forEach(function (k) {
      maxChildren = Math.max(maxChildren, childrenOf[k].length);
    });
    var depthSpacing = Math.max(10, (MIN_ARC_PER_NODE * maxChildren) / CONE_ANGLE);

    var positions = {};
    function place(node, depth, angleStart, angleEnd) {
      var angle = (angleStart + angleEnd) / 2;
      var radius = depth * depthSpacing;
      positions[node] = {
        x: radius * Math.sin(angle),
        z: -radius * Math.cos(angle),
        depth: depth,
        leaves: leafCount[node],
      };
      var kids = childrenOf[node] || [];
      if (!kids.length) return;
      var span = angleEnd - angleStart;
      var total = leafCount[node] || 1;
      var cursor = angleStart;
      kids.forEach(function (k) {
        var portion = (leafCount[k] / total) * span;
        place(k, depth + 1, cursor, cursor + portion);
        cursor += portion;
      });
    }
    place(root, 0, -CONE_ANGLE / 2, CONE_ANGLE / 2);
    return { positions: positions, depthSpacing: depthSpacing };
  }

  // --- Fetch the tree and build the scene ----------------------------------
  fetch('/api/graph')
    .then(function (r) {
      if (!r.ok) throw new Error('failed to load graph');
      return r.json();
    })
    .then(function (data) {
      var nodes = data.nodes || [];
      var edges = data.edges || [];
      if (!nodes.length || !data.root) {
        setStatus('그래프를 그릴 페이지가 없습니다.');
        return;
      }
      setStatus('');
      buildScene(data.root, nodes, edges);
    })
    .catch(function () {
      setStatus('그래프를 불러오지 못했습니다.');
    });

  function buildScene(root, nodes, edges) {
    var childrenOf = {};
    var parentOf = {};
    edges.forEach(function (e) {
      if (!childrenOf[e.parent]) childrenOf[e.parent] = [];
      childrenOf[e.parent].push(e.child);
      parentOf[e.child] = e.parent;
    });

    var layout = layoutTree(root, childrenOf);
    var positions = layout.positions;
    var depthSpacing = layout.depthSpacing;
    var minX = 0, maxX = 0, maxDepth = 0;
    for (var id in positions) {
      var p = positions[id];
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      maxDepth = Math.max(maxDepth, p.depth);
    }
    var totalDepthSpan = Math.max(maxDepth * depthSpacing, 40);
    var totalWidthSpan = Math.max(maxX - minX, 40);

    var scene = new THREE.Scene();

    // Screen-space sky gradient: a band of bright green glowing at the
    // horizon, fading to black both above (sky) and below. A flat texture
    // (not an environment map) so it stays fixed relative to the screen.
    var skyCanvas = document.createElement('canvas');
    skyCanvas.width = 2;
    skyCanvas.height = 256;
    var skyCtx = skyCanvas.getContext('2d');
    var skyGradient = skyCtx.createLinearGradient(0, 0, 0, 256);
    skyGradient.addColorStop(0, '#000000');
    skyGradient.addColorStop(0.55, '#33cc5a');
    skyGradient.addColorStop(1, '#000000');
    skyCtx.fillStyle = skyGradient;
    skyCtx.fillRect(0, 0, 2, 256);
    scene.background = new THREE.CanvasTexture(skyCanvas);

    var fogFar = totalDepthSpan * 2.2;
    scene.fog = new THREE.Fog(0x0b2412, fogFar * 0.35, fogFar);

    var camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 3000);
    camera.position.set(0, totalDepthSpan * 0.22, totalDepthSpan * 0.35);

    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    var controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0, -totalDepthSpan * 0.35);
    controls.maxDistance = totalDepthSpan * 3;
    controls.minDistance = 2;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.update();

    // Giant flat ground plane the whole tree sits on - a plain solid color floor.
    var groundW = totalWidthSpan * 1.6;
    var groundD = totalDepthSpan * 1.6;

    var ground = new THREE.Mesh(
      new THREE.PlaneGeometry(groundW, groundD),
      new THREE.MeshStandardMaterial({ color: 0x7a3350, roughness: 0.95, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((minX + maxX) / 2, 0, -totalDepthSpan * 0.5 + depthSpacing * 0.5);
    ground.receiveShadow = true;
    scene.add(ground);

    // Lighting: one fixed "sun" casts real shadows for a solid, 3D look;
    // hemisphere light keeps shadowed areas from going fully black.
    scene.add(new THREE.HemisphereLight(0x8899aa, 0x101014, 0.9));
    var treeCenterX = (minX + maxX) / 2;
    var treeCenterZ = -totalDepthSpan / 2;
    var sun = new THREE.DirectionalLight(0xfff2d8, 1.3);
    sun.target.position.set(treeCenterX, 0, treeCenterZ);
    sun.position.set(treeCenterX + totalWidthSpan * 0.4, totalDepthSpan * 0.6, treeCenterZ + totalDepthSpan * 0.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    var shadowSpan = Math.max(totalWidthSpan, totalDepthSpan) * 0.7;
    sun.shadow.camera.left = -shadowSpan;
    sun.shadow.camera.right = shadowSpan;
    sun.shadow.camera.top = shadowSpan;
    sun.shadow.camera.bottom = -shadowSpan;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = totalDepthSpan * 3;
    sun.shadow.bias = -0.0015;
    sun.shadow.camera.updateProjectionMatrix();
    scene.add(sun);
    scene.add(sun.target);

    // --- Nodes: flat cardboard-colored boxes, size trimmed a little by depth
    var boxMaterial = new THREE.MeshStandardMaterial({ color: 0x87ceeb, roughness: 0.75, metalness: 0.05 });
    var selectedMaterial = new THREE.MeshStandardMaterial({
      color: 0xffe9a8,
      emissive: 0xffaa22,
      emissiveIntensity: 1.1,
      roughness: 0.5,
    });

    var nodeMeshes = [];
    nodes.forEach(function (n) {
      var p = positions[n.id];
      if (!p) return;
      var depthScale = 1 / (1 + p.depth * 0.12);
      var isRoot = n.id === root;
      var footprint = (isRoot ? 4.4 : 2.1 + Math.min(Math.log2(p.leaves + 1), 5) * 0.35) * depthScale * 2;
      var boxHeight = (isRoot ? 2.6 : 1.1) * depthScale * 2;
      var mesh = new THREE.Mesh(new THREE.BoxGeometry(footprint, boxHeight, footprint * 0.72), boxMaterial);
      mesh.position.set(p.x, boxHeight / 2, p.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.name = n.id;
      mesh.userData.top = boxHeight;
      mesh.userData.childCount = (childrenOf[n.id] || []).length;
      scene.add(mesh);
      nodeMeshes.push(mesh);
    });

    // Links: plain white lines laid on the floor between node footprints.
    // WebGL ignores LineBasicMaterial.linewidth on most platforms (Chrome/
    // Brave included), so a real thickness needs actual geometry - a thin
    // flat strip - rather than a GL line.
    var LINK_GROUND_Y = 0.12;
    var LINK_WIDTH = 0.3;
    var linkGroup = new THREE.Group();
    var linkMaterial = new THREE.MeshBasicMaterial({ color: 0xbdb76b });
    // Invisible material used only for the oversized click target below - the
    // visible ribbon is far too thin/flat to reliably hit with a raycast at
    // the shallow viewing angles this scene is usually seen from.
    var linkHitMaterial = new THREE.MeshBasicMaterial({ visible: false });
    edges.forEach(function (e) {
      var a = positions[e.parent];
      var b = positions[e.child];
      if (!a || !b) return;
      var dx = b.x - a.x;
      var dz = b.z - a.z;
      var length = Math.hypot(dx, dz);
      if (length < 0.01) return;
      var angle = -Math.atan2(dz, dx);
      var strip = new THREE.Mesh(new THREE.BoxGeometry(length, 0.05, LINK_WIDTH), linkMaterial);
      strip.position.set((a.x + b.x) / 2, LINK_GROUND_Y, (a.z + b.z) / 2);
      strip.rotation.y = angle;
      strip.userData.parentName = e.parent;
      strip.userData.childName = e.child;
      linkGroup.add(strip);

      // Oversized, invisible click target riding along the same strip so a
      // click anywhere near the road - not just the exact thin ribbon - hits.
      var hitBox = new THREE.Mesh(new THREE.BoxGeometry(length, 1.6, LINK_WIDTH * 6), linkHitMaterial);
      hitBox.position.set((a.x + b.x) / 2, LINK_GROUND_Y + 0.8, (a.z + b.z) / 2);
      hitBox.rotation.y = angle;
      hitBox.userData.parentName = e.parent;
      hitBox.userData.childName = e.child;
      linkGroup.add(hitBox);
    });
    scene.add(linkGroup);

    // --- Selection: clicking a box turns on its lamp and flies the camera in
    var raycaster = new THREE.Raycaster();
    var mouse = new THREE.Vector2();
    var selectedMesh = null;
    var selectedLamp = null;
    var selectedBeam = null;
    var cameraAnim = null;

    // Which way is this node's own subtree branching? Average direction to
    // its children; a childless leaf instead continues the direction it was
    // reached from (parent -> this node), so the camera still looks "onward".
    function branchDirection(name) {
      var p = positions[name];
      var dir = new THREE.Vector3();
      var kids = childrenOf[name] || [];
      if (kids.length) {
        kids.forEach(function (k) {
          var kp = positions[k];
          if (kp) dir.add(new THREE.Vector3(kp.x - p.x, 0, kp.z - p.z));
        });
      } else if (parentOf[name] && positions[parentOf[name]]) {
        var pp = positions[parentOf[name]];
        dir.set(p.x - pp.x, 0, p.z - pp.z);
      }
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
      return dir.normalize();
    }

    function flyTo(newCamPos, newTarget, duration) {
      var startCamPos = camera.position.clone();
      var startTarget = controls.target.clone();
      var startTime = null;
      cameraAnim = function (now) {
        if (startTime === null) startTime = now;
        var t = Math.min((now - startTime) / duration, 1);
        var ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        camera.position.lerpVectors(startCamPos, newCamPos, ease);
        controls.target.lerpVectors(startTarget, newTarget, ease);
        if (t >= 1) cameraAnim = null;
      };
    }

    function clearSelection() {
      if (selectedMesh) selectedMesh.material = boxMaterial;
      if (selectedLamp) {
        scene.remove(selectedLamp.target);
        scene.remove(selectedLamp);
        selectedLamp = null;
      }
      if (selectedBeam) {
        scene.remove(selectedBeam);
        selectedBeam = null;
      }
      selectedMesh = null;
      panelEl.classList.remove('visible');
    }

    function selectMesh(mesh, moveCamera) {
      clearSelection();
      selectedMesh = mesh;
      mesh.material = selectedMaterial;

      // A stage-light spotlight, not an omnidirectional point light: a
      // narrow cone with a crisp, hard edge (near-zero penumbra) aimed
      // straight down at just this box, like a handheld flashlight picking
      // out a sharply bounded circle on the ground.
      var spotAngle = Math.atan(2 * Math.tan(Math.PI / 9)) / 4;
      var lampHeight = mesh.userData.top + 45;
      var lamp = new THREE.SpotLight(0xfff2b8, 7, 100, spotAngle, 0.03, 2);
      lamp.position.set(mesh.position.x, lampHeight, mesh.position.z);
      lamp.target.position.set(mesh.position.x, mesh.position.y, mesh.position.z);
      scene.add(lamp);
      scene.add(lamp.target);
      selectedLamp = lamp;

      // A translucent cone makes the beam itself visible, not just the spot
      // it lands on - like a spotlight's shaft cutting through haze.
      var beamHeight = lampHeight - mesh.position.y;
      var beamRadius = beamHeight * Math.tan(spotAngle);
      var beam = new THREE.Mesh(
        new THREE.ConeGeometry(beamRadius, beamHeight, 24, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xfff2b8,
          transparent: true,
          opacity: 0.16,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      beam.position.set(mesh.position.x, mesh.position.y + beamHeight / 2, mesh.position.z);
      scene.add(beam);
      selectedBeam = beam;

      panelTitle.textContent = mesh.userData.name;
      panelMeta.textContent = '연결된 하위 문서: ' + mesh.userData.childCount + '개';
      panelOpen.href = '/page/' + encodeURIComponent(mesh.userData.name);
      panelEl.classList.add('visible');

      if (moveCamera !== false) {
        var dir = branchDirection(mesh.userData.name);
        var nodePos = mesh.position.clone();
        var behind = depthSpacing * 0.13;
        var elevation = depthSpacing * 0.035;
        var ahead = depthSpacing * 0.22;
        var newCamPos = nodePos.clone().addScaledVector(dir, -behind).add(new THREE.Vector3(0, elevation, 0));
        var newTarget = nodePos.clone().addScaledVector(dir, ahead);
        flyTo(newCamPos, newTarget, 1700);
      }
    }

    // A link click has no box of its own to select - it hands off to whichever
    // end of the road (parent or child) the click landed closer to, so clicking
    // near either building along that road lights it up and flies there.
    function meshForName(name) {
      return nodeMeshes.filter(function (m) { return m.userData.name === name; })[0];
    }

    function nearerEndpoint(point, ud) {
      var pp = positions[ud.parentName];
      var cp = positions[ud.childName];
      if (!pp) return ud.childName;
      if (!cp) return ud.parentName;
      var dp = Math.hypot(point.x - pp.x, point.z - pp.z);
      var dc = Math.hypot(point.x - cp.x, point.z - cp.z);
      return dp <= dc ? ud.parentName : ud.childName;
    }

    function onPointerDown(ev) {
      if (ev.button !== 0) return;
      mouse.x = (ev.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(ev.clientY / window.innerHeight) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      var nodeHits = raycaster.intersectObjects(nodeMeshes);
      if (nodeHits.length) {
        selectMesh(nodeHits[0].object);
        return;
      }
      var linkHits = raycaster.intersectObjects(linkGroup.children);
      if (linkHits.length) {
        var hit = linkHits[0];
        var name = nearerEndpoint(hit.point, hit.object.userData);
        var target = meshForName(name);
        if (target) {
          selectMesh(target);
          return;
        }
      }
      clearSelection();
    }
    renderer.domElement.addEventListener('pointerdown', onPointerDown);

    function onPointerMove(ev) {
      mouse.x = (ev.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(ev.clientY / window.innerHeight) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      var hits = raycaster.intersectObjects(nodeMeshes).length || raycaster.intersectObjects(linkGroup.children).length;
      renderer.domElement.style.cursor = hits ? 'pointer' : 'grab';
    }
    renderer.domElement.addEventListener('pointermove', onPointerMove);

    window.addEventListener('resize', function () {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Auto-select the root (downtown) on load, but keep the wide establishing
    // shot rather than immediately flying the camera in.
    var rootMesh = nodeMeshes.filter(function (m) { return m.userData.name === root; })[0];
    if (rootMesh) selectMesh(rootMesh, false);

    (function animate() {
      requestAnimationFrame(animate);
      if (cameraAnim) cameraAnim(performance.now());
      controls.update();
      renderer.render(scene, camera);
    })();
  }
})();
