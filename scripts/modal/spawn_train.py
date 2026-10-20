"""Start training on the deployed app, independent of this machine (survives reboots and closed sessions).

  modal deploy scripts/modal/evolve_modal.py      # after any change to BASE_ARGS / src / scripts/evolve
  python3 scripts/modal/spawn_train.py cleveland 5 public/ai-models/cleveland-f4/expert.json aggr4
Stop: modal app stop -y simgame-evolve   (the same tag resumes from its newest population on the next spawn)
"""
import pathlib
import sys

import modal

track, hours, seed, tag = sys.argv[1], float(sys.argv[2]), sys.argv[3], sys.argv[4]
p = pathlib.Path(seed)
call = modal.Function.from_name("simgame-evolve", "train").spawn(track, hours, f"{p.parent.name}-{p.name}", p.read_text(), [], tag)
print(call.object_id)
