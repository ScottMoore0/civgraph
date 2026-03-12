const { test, expect } = require('@playwright/test');

test('election slider stays visible while switching from 2019 local election to 2018 local by-election', async ({ page }) => {
  await page.goto('/');

  const duringLoad = await page.evaluate(async () => {
    const electionController = (await import('/js/election-controller.js')).default;
    const timeSliderController = (await import('/js/time-slider-controller.js')).default;

    const originalLoadAllResults = electionController._loadAllResults.bind(electionController);
    electionController._loadAllResults = async function(body, date, ...rest) {
      if (date === '2018-10-18') {
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
      return originalLoadAllResults(body, date, ...rest);
    };

    await electionController.loadElection('Mid and East Antrim', '2019-05-02');

    const targetIndex = timeSliderController._electionDatesSorted.findIndex((d) => d === '2018-10-18');
    timeSliderController.slider.value = String(targetIndex);
    timeSliderController.handleSliderInput();
    timeSliderController.handleSliderCommit();

    await new Promise((resolve) => setTimeout(resolve, 100));

    return {
      sliderHidden: document.getElementById('timelineSlider')?.classList.contains('hidden') || false,
      label: document.getElementById('timelineLabel')?.textContent || '',
      bodyDuringLoad: electionController.body,
      dateDuringLoad: electionController.date
    };
  });

  expect(duringLoad.sliderHidden).toBe(false);
  expect(duringLoad.label).toContain('2018');

  await page.waitForFunction(async () => {
    const electionController = (await import('/js/election-controller.js')).default;
    return electionController.date === '2018-10-18';
  });

  const finalState = await page.evaluate(async () => {
    const electionController = (await import('/js/election-controller.js')).default;
    return {
      body: electionController.body,
      date: electionController.date,
      sliderHidden: document.getElementById('timelineSlider')?.classList.contains('hidden') || false
    };
  });

  expect(finalState.body).toBe('Mid and East Antrim');
  expect(finalState.date).toBe('2018-10-18');
  expect(finalState.sliderHidden).toBe(false);
});
