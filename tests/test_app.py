import pytest

from lens_view.app import LensView
from lens_view.trace import EXAMPLE


@pytest.mark.asyncio
async def test_opens_trace_and_cycles_lenses():
    app = LensView(EXAMPLE, lens='logit')
    async with app.run_test(size=(90, 30)) as pilot:
        await pilot.pause()
        assert app.lens_index == 1
        await pilot.press('l')
        assert app.lens_index == 0
        assert str(EXAMPLE) in str(app.query_one('#filepath').render())


@pytest.mark.asyncio
async def test_opens_without_trace():
    app = LensView(None)
    async with app.run_test() as pilot:
        await pilot.pause()
        assert app.trace is None
