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

  function orientPipeBetween(mesh, a, b) {
    var start = new THREE.Vector3(a.x, a.y, a.z);
    var end = new THREE.Vector3(b.x, b.y, b.z);
    var mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    mesh.position.copy(mid);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize());
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
    edges.forEach(function (e) {
      if (!childrenOf[e.parent]) childrenOf[e.parent] = [];
      childrenOf[e.parent].push(e.child);
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
    scene.background = new THREE.Color(0x050505);
    var fogFar = totalDepthSpan * 2.2;
    scene.fog = new THREE.Fog(0x050505, fogFar * 0.35, fogFar);

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
    controls.minDistance = 5;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.update();

    // Giant flat ground plane the whole tree sits on.
    var groundW = totalWidthSpan * 1.6;
    var groundD = totalDepthSpan * 1.6;
    var ground = new THREE.Mesh(
      new THREE.PlaneGeometry(groundW, groundD),
      new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.95, metalness: 0 })
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

    var pipeMaterial = new THREE.MeshStandardMaterial({ color: 0x5c1414, roughness: 0.4, metalness: 0.3 });

    // --- Nodes: flat cardboard-colored boxes, size trimmed a little by depth
    var boxMaterial = new THREE.MeshStandardMaterial({ color: 0xcaa46a, roughness: 0.85, metalness: 0.05 });
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
      var footprint = (isRoot ? 4.4 : 2.1 + Math.min(Math.log2(p.leaves + 1), 5) * 0.35) * depthScale;
      var boxHeight = (isRoot ? 2.6 : 1.1) * depthScale;
      var mesh = new THREE.Mesh(new THREE.BoxGeometry(footprint, boxHeight, footprint * 0.72), boxMaterial);
      mesh.position.set(p.x, boxHeight / 2, p.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.name = n.id;
      mesh.userData.top = boxHeight;
      mesh.userData.childCount = (childrenOf[n.id] || []).length;
      scene.add(mesh);
      nodeMeshes.push(mesh);
      p.__top = boxHeight;
    });

    // Links: dark red pipes with real thickness, not flat roads. Built after
    // the boxes above so each pipe can reach its node's actual top height.
    var pipeGroup = new THREE.Group();
    edges.forEach(function (e) {
      var a = positions[e.parent];
      var b = positions[e.child];
      if (!a || !b) return;
      var start = { x: a.x, y: a.__top || 0.6, z: a.z };
      var end = { x: b.x, y: b.__top || 0.6, z: b.z };
      var length = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
      if (length < 0.01) return;
      var pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, length, 8), pipeMaterial);
      orientPipeBetween(pipe, start, end);
      pipe.castShadow = true;
      pipeGroup.add(pipe);
    });
    scene.add(pipeGroup);

    // --- Selection: clicking a box turns on its lamp ------------------------
    var raycaster = new THREE.Raycaster();
    var mouse = new THREE.Vector2();
    var selectedMesh = null;
    var selectedLamp = null;

    function clearSelection() {
      if (selectedMesh) selectedMesh.material = boxMaterial;
      if (selectedLamp) {
        scene.remove(selectedLamp);
        selectedLamp = null;
      }
      selectedMesh = null;
      panelEl.classList.remove('visible');
    }

    function selectMesh(mesh) {
      clearSelection();
      selectedMesh = mesh;
      mesh.material = selectedMaterial;

      var lamp = new THREE.PointLight(0xffd76b, 3, 30, 2);
      lamp.position.set(mesh.position.x, mesh.userData.top + 5, mesh.position.z);
      scene.add(lamp);
      selectedLamp = lamp;

      panelTitle.textContent = mesh.userData.name;
      panelMeta.textContent = '연결된 하위 문서: ' + mesh.userData.childCount + '개';
      panelOpen.href = '/page/' + encodeURIComponent(mesh.userData.name);
      panelEl.classList.add('visible');
    }

    function onPointerDown(ev) {
      if (ev.button !== 0) return;
      mouse.x = (ev.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(ev.clientY / window.innerHeight) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      var hits = raycaster.intersectObjects(nodeMeshes);
      if (hits.length) {
        selectMesh(hits[0].object);
      } else {
        clearSelection();
      }
    }
    renderer.domElement.addEventListener('pointerdown', onPointerDown);

    function onPointerMove(ev) {
      mouse.x = (ev.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(ev.clientY / window.innerHeight) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      var hits = raycaster.intersectObjects(nodeMeshes);
      renderer.domElement.style.cursor = hits.length ? 'pointer' : 'grab';
    }
    renderer.domElement.addEventListener('pointermove', onPointerMove);

    window.addEventListener('resize', function () {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Auto-select the root (downtown) on load.
    var rootMesh = nodeMeshes.filter(function (m) { return m.userData.name === root; })[0];
    if (rootMesh) selectMesh(rootMesh);

    (function animate() {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    })();
  }
})();
