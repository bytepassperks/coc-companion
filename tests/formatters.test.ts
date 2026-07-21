import { describe, expect, it } from "vitest";
import { humanizeCategory, humanizeSubject } from "../src/formatters";

describe("dashboard copy formatters", () => {
  it("maps recommendation slugs to friendly labels", () => {
    expect(humanizeCategory("heroes_equipment")).toBe("Heroes & equipment");
    expect(humanizeCategory("clan_castle")).toBe("Clan Castle");
    expect(humanizeCategory("offense_buildings")).toBe("Offense buildings");
    expect(humanizeSubject("town_hall_weapon")).toBe("Town Hall Weapon");
  });
});
