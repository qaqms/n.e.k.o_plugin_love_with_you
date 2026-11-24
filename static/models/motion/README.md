# Yui motion clips

Copied unchanged (gzip VRMA, VRM 1.0 humanoid) from the N.E.K.O host's `static/vrm/animation/`:

| here | host file |
| --- | --- |
| idle01–idle05.vrma.gz | wait01–wait05.vrma.gz |
| liked.vrma.gz | liked.vrma.gz |
| vsign.vrma.gz | 比 V 手势.vrma.gz |

For her day in the house (0.9.40), from the host's motion library `static/vrm/motion/` and `static/vrm/animation/`:

| here | host file |
| --- | --- |
| walk.vrma.gz | animation/world-walk.vrma.gz |
| sit.vrma.gz | motion/05_pose/双脚平放端正地坐.vrma.gz |
| type.vrma.gz | motion/06_activity/坐着用双手敲击键盘.vrma.gz |
| tablet.vrma.gz | motion/06_activity/站着用手操作平板电脑.vrma.gz |
| sleep.vrma.gz | motion/05_pose/趴着安静熟睡轻微呼吸.vrma.gz |
| sleep-turn.vrma.gz | motion/05_pose/趴着睡梦中翻动身体.vrma.gz |
| yawn.vrma.gz | motion/03_emote/困倦地抬手打哈欠.vrma.gz |
| stretch.vrma.gz | motion/03_emote/开心地舒展身体.vrma.gz |

For getting into and out of bed (0.9.41), played in parts forward or backward:

| here | host file |
| --- | --- |
| getup.vrma.gz | motion/08_move/从低姿态撑起身体站好.vrma.gz |

For answering a click where she is (0.9.49): laughing in her seat (a part of it), and starting while busy on her feet:

| here | host file |
| --- | --- |
| sit-laugh.vrma.gz | motion/03_emote/坐着开心地大笑.vrma.gz |
| startle.vrma.gz | motion/03_emote/惊讶地向后缩起身体.vrma.gz |

The host's `static/vrm/motion/manifest.json` lists the `motion/` clips (seven, `getup` since 0.9.41, and `sit-laugh` and `startle` since 0.9.49) as Apache-2.0 with the origin `VSWQH`;
`world-walk` is covered by the notice beside these files. Whether the `motion/` clips may ship with the plugin is to be
confirmed by the project owner (the earlier confirmation was for the idle and gesture clips above).

The host's attribution notice is kept beside them as `HANAMI_VRMA_NOTICE.md`.
The project owner, who works on the host, confirmed these may ship with the plugin.
