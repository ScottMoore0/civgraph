const { test, expect } = require('@playwright/test');

test('election slider is discrete and stale election loads cannot win', async ({ page }) => {
  await page.goto('/');

  const initial = await page.evaluate(async () => {
    const electionController = (await import('/js/election-controller.js')).default;
    const timeSliderController = (await import('/js/time-slider-controller.js')).default;

    const originalLoadAllResults = electionController._loadAllResults.bind(electionController);
    electionController._loadAllResults = async function(body, date, ...rest) {
      if (date === '2017-03-02') {
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      return originalLoadAllResults(body, date, ...rest);
    };

    const older = electionController.loadElection('Northern Ireland Assembly', '2017-03-02');
    const newer = electionController.loadElection('Northern Ireland Assembly', '2022-05-05');
    await Promise.allSettled([older, newer]);

    return {
      finalDate: electionController.date,
      title: document.getElementById('electionPaneTitle')?.textContent || '',
      sliderMin: timeSliderController.slider?.min || '',
      sliderMax: timeSliderController.slider?.max || '',
      sliderStep: timeSliderController.slider?.step || '',
      sliderValue: timeSliderController.slider?.value || '',
      currentIndex: timeSliderController.currentIndex,
      electionCount: timeSliderController._electionDatesSorted?.length || 0
    };
  });

  expect(initial.finalDate).toBe('2022-05-05');
  expect(initial.title).toContain('Assembly');
  expect(initial.sliderMin).toBe('0');
  expect(initial.sliderMax).toBe(String(initial.electionCount - 1));
  expect(initial.sliderStep).toBe('1');
  expect(initial.sliderValue).toBe(String(initial.currentIndex));

  const preview = await page.evaluate(async () => {
    const electionController = (await import('/js/election-controller.js')).default;
    const timeSliderController = (await import('/js/time-slider-controller.js')).default;

    const targetIndex = 0;
    const targetDate = timeSliderController._electionDatesSorted[targetIndex];
    timeSliderController.slider.value = String(targetIndex);
    timeSliderController.handleSliderInput();

    return {
      targetDate,
      previewIndex: timeSliderController._previewIndex,
      label: document.getElementById('timelineLabel')?.textContent || '',
      dateAfterInput: electionController.date
    };
  });

  expect(preview.previewIndex).toBe(0);
  expect(preview.dateAfterInput).toBe('2022-05-05');

  await page.evaluate(async () => {
    const timeSliderController = (await import('/js/time-slider-controller.js')).default;
    timeSliderController.handleSliderCommit();
  });

  await page.waitForFunction(async (expectedDate) => {
    const electionController = (await import('/js/election-controller.js')).default;
    return electionController.date === expectedDate;
  }, preview.targetDate);

  const committed = await page.evaluate(async () => {
    const electionController = (await import('/js/election-controller.js')).default;
    const timeSliderController = (await import('/js/time-slider-controller.js')).default;
    return {
      finalDate: electionController.date,
      sliderValue: timeSliderController.slider?.value || '',
      currentIndex: timeSliderController.currentIndex,
      previewIndex: timeSliderController._previewIndex
    };
  });

  expect(committed.finalDate).toBe(preview.targetDate);
  expect(committed.sliderValue).toBe(String(committed.currentIndex));
  expect(committed.previewIndex).toBe(null);
});
