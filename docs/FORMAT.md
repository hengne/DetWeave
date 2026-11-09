# 几何约定与能力矩阵

Schema `0.1` 的唯一来源为 `detweave/schema.json`，由 `scripts/make_schema.py` 维护。

- 所有长度 **mm，全长**；圆管 rmin/rmax 是半径，length_mm 是全长。
- 右手坐标；圆管轴为 z，角覆盖 360°；无旋转。
- volume 是可复用形状／材料定义；placement 是单个放置，parent 引用放置 ID 或 `world`。
- position_mm 为相对母体的局部坐标；全局位置通过祖先位置累加。
- repeat 的第 i 项位置为 position_mm + i×step_mm，i 从 0 开始。重复母体的子放置暂不支持，必须显式展开。
- 最多 100 个定义、500 个放置定义、1,000 个展开实例；限制用于本地交互可靠性。
- world 为以全局原点为中心的长方体。未明确的 world 尺寸与材料也必须标成假设。
- `evidence` 覆盖 world 的尺寸／材料，各 volume 的 shape／material，各 placement 的 volume／parent／position／repeat。
- 引文必须是 source_text 的精确子串。`quote` 支持一个字符串或最多 12 个字符串组成的数组；多段不连续原文必须分开列出，每段单独核对，不允许拼接后冒充连续原文。模型不能自称用户已确认；模型输出中的 confirmed 会降为 stated。
- derived 是待人审阅的推导，首版不会把自由文本推导当作已验证数学公式。
- JSON 编辑是专家入口；更改参数后应同步更新依据。可导出不是科学语义自动认证。

| 特征 | GDML | Geant4 C++ | DD4hep | 预览 |
|---|---|---|---|---|
| 长方体、圆柱、圆管 | 支持 | 支持 | 配套构造器 | 支持，圆管网格有离散误差 |
| 层级与平移 | 支持 | 支持 | 支持，world 下有零偏移 assembly | 支持 |
| 重复放置 | 显式展开，共享形状 | 显式展开，共享形状 | 显式展开 | 显式展开 |
| 材料 | G4 11.1.3 GDML 快照 | 读取相同快照 | 转换受 ROOT/DD4hep 限制，见验证记录 | 按材料名着色 |
| 旋转、布尔体、切角管 | 拒绝 | 拒绝 | 拒绝 | 拒绝 |
| 自定义材料、光学表面、敏感体、场 | 尚未实现 | 尚未实现 | 尚未实现 | 不作物理解释 |

解析重叠检查只检查同级体积，不把合法的母子嵌套判为碰撞。触面不算正体积重叠；
内部比较容差 1e-7 mm。对于更薄结构，需要重新评估数值尺度与原生检查配置。
三维视图使用投影与离散网格，不能替代后端几何检查。

### Numerical resolution / 数值分辨范围

The current analytic validator rejects world/box dimensions, tube lengths and tube
wall thickness below `1e-6 mm` (ten times its maximum comparison tolerance of
`1e-7 mm`). This is an explicit supported numerical-resolution boundary, **not a
physical minimum detector feature size**. No dimensions are silently enlarged.
Direct overlap comparisons additionally bound their tolerance by one quarter of
the smallest feature, so coincident thin objects cannot disappear under tolerance.
Near-touching differences below tolerance still require target-engine checks.

当前解析校验器不接受小于 `1e-6 mm` 的世界体积／盒体尺寸、圆管长度和壁厚。这是本
实现的数值适用范围，不是探测器物理上的最小尺寸限制；程序不会静默放大结构。
亚容差间隙或交叠仍需在目标几何引擎中验证。
